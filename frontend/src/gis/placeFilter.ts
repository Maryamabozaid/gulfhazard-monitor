import { bbox, booleanIntersects, booleanPointInPolygon, circle } from "@turf/turf";
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from "geojson";
import { useEffect, useMemo, useState } from "react";
import { loadPlaceLabels } from "./cartography";

export type Boundary = Feature<Polygon | MultiPolygon>;
export type Bounds = [number, number, number, number];
export type PlaceKind = "country" | "region" | "city" | "sea";
export type Place = {
  id: string; kind: PlaceKind; name: string; ar: string; country: string;
  terms: string[]; rank: number; boundary?: Boundary; center?: [number, number];
};
type Catalogue = { places: Place[]; byId: Map<string, Place> };
const gcc = ["SAU","ARE","KWT","QAT","BHR","OMN"];
const gulfCoasts = [...gcc,"IRQ","IRN"];
const countryCodes = [...gulfCoasts,"EGY","YEM","JOR"];
export const gccIds = gcc.map(code=>"country:"+code);
export const wholeGulfIds = [...gulfCoasts.map(code=>"country:"+code),"sea:gulf"];
const aliases: Record<string, string[]> = {
  SAU: ["Saudi", "KSA", "المملكة العربية السعودية"], EGY: ["Misr", "جمهورية مصر العربية"],
  ARE: ["UAE", "Emirates", "الإمارات العربية المتحدة"], OMN: ["سلطنة عمان"],
  Makkah: ["Mecca", "مكة المكرمة"], Medina: ["Madinah", "المدينة المنورة"],
  Madinah: ["Medina", "المدينة المنورة"], "Abu Dhabi": ["أبو ظبي", "أبوظبي"],
};
export const cityRadius = 25;
export function normalizeName(text: string) {
  return text.normalize("NFKD").toLowerCase().replace(/[\p{M}ـ]/gu, "")
    .replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[-'’]/g, " ").replace(/\s+/g, " ").trim();
}
async function boundaries(name: string): Promise<Boundary[]> {
  const response = await fetch("/cartography/" + name + ".geojson");
  if (!response.ok) throw Error(name);
  return (await response.json() as FeatureCollection<Polygon | MultiPolygon>).features;
}
const featureBounds = new WeakMap<Geometry, Bounds>();
function boundsOf(geometry: Geometry) {
  let box = featureBounds.get(geometry);
  if (!box) { box = bbox(geometry) as Bounds; featureBounds.set(geometry, box); }
  return box;
}
function overlaps(a: Bounds, b: Bounds) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}
async function buildCatalogue(): Promise<Catalogue> {
  const [land, regions, seas, labels] = await Promise.all([boundaries("land"), boundaries("regions"), boundaries("gulf-waters"), loadPlaceLabels()]);
  const countries = land.filter(f => countryCodes.includes(f.properties!.iso3));
  const countryByIso2 = new Map(countries.map(f => [f.properties!.iso2, f.properties!.iso3 as string]));
  const places: Place[] = [];
  function add(place: Omit<Place, "terms">, extra: string[] = []) {
    places.push({...place, terms: [...new Set([place.name, place.ar, ...(aliases[place.name] || []), ...extra].filter(Boolean).map(normalizeName))]});
  }
  for (const f of countries) {
    const {iso3, iso2, name} = f.properties!;
    const ar = labels.features.find(l => l.properties?.iso3 === iso3)?.properties?.ar || name;
    add({id:"country:"+iso3, kind:"country", name, ar, country:iso3, rank:countryCodes.indexOf(iso3), boundary:f}, [iso2, iso3, ...(aliases[iso3] || [])]);
  }
  for (const f of regions) {
    const {name, ar, iso3, aliases:alternate} = f.properties!;
    add({id:String(f.id), kind:"region", name, ar, country:iso3, rank:0, boundary:f}, alternate);
  }
  for (const f of seas) {
    const {name,ar} = f.properties!;
    add({id:String(f.id), kind:"sea", name, ar, country:"", rank:0, boundary:f}, ["Arabian Gulf","Persian Gulf","الخليج العربي","الخليج الفارسي"]);
  }
  for (const f of labels.features) {
    const p = f.properties;
    if (p?.kind !== "city") continue;
    const country = p.country ? countryByIso2.get(p.country) : countries.find(c =>
      overlaps(boundsOf(c.geometry), boundsOf(f.geometry)) && booleanPointInPolygon(f, c))?.properties?.iso3;
    if (!country) continue;
    add({id:"city:"+(f.id ?? country+":"+p.name), kind:"city", name:p.name, ar:p.ar || p.name,
      country, rank:p.rank, center:f.geometry.coordinates as [number, number]});
  }
  const order = {country:0, sea:1, region:2, city:3};
  places.sort((a,b) => order[a.kind]-order[b.kind] || a.rank-b.rank || a.name.localeCompare(b.name));
  return {places, byId:new Map(places.map(p => [p.id,p]))};
}
let cataloguePromise: Promise<Catalogue> | undefined;
function getCatalogue() {
  return cataloguePromise ??= buildCatalogue().catch(error => { cataloguePromise=undefined; throw error; });
}
export function usePlaceFilter(ids: string[], open: boolean) {
  const [catalogue, setCatalogue] = useState<Catalogue>();
  const [error, setError] = useState(false);
  const [attempt, retry] = useState(0);
  const needed = open || ids.length > 0;
  useEffect(() => {
    if (!needed || catalogue) return;
    let live = true;
    setError(false);
    getCatalogue().then(data => { if(live) setCatalogue(data); }).catch(() => { if(live) setError(true); });
    return () => { live = false; };
  }, [needed, catalogue, attempt]);
  const areas = useMemo<FeatureCollection<Polygon | MultiPolygon>>(() => ({
    type:"FeatureCollection",
    features:ids.flatMap(id => {
      const place = catalogue?.byId.get(id);
      if (!place) return [];
      return [place.boundary ?? circle(place.center!, cityRadius, {steps:96, units:"kilometers"})];
    })
  }), [ids, catalogue]);
  const matches = useMemo(() => {
    if (!ids.length) return (_: Geometry) => true;
    const prepared = areas.features.map(f => ({f, box:boundsOf(f.geometry)}));
    return (geometry: Geometry) => {
      const box = boundsOf(geometry);
      return prepared.some(({f, box:regionBox}) => overlaps(box, regionBox) &&
        (geometry.type === "Point" ? booleanPointInPolygon(geometry,f) : booleanIntersects(geometry,f)));
    };
  }, [ids,areas]);
  return {catalogue, error, retry:() => retry(n=>n+1), areas, matches};
}
export type PlaceFilterState = ReturnType<typeof usePlaceFilter>;
