import { parse } from "csv-parse/sync";
import {sgsEvents,mergeSeismic} from "./regional-providers.mjs";
import {profile} from "./licensing.mjs";
import {industrialReason} from "./thermal.mjs";
import {
  BOX,
  inside,
  params,
  json,
  request,
  day,
  addDays,
  utc,
  numeric,
  point,
  feature,
  safeLink,
} from "./net.mjs";

const USGS = "https://earthquake.usgs.gov/fdsnws/event/1/query";
const CER = "https://api.cerulean.skytruth.org/collections/";
const FIRMS = "https://firms.modaps.eosdis.nasa.gov";
export function quake(f, emsc = false) {
  const p = f.properties;
  return feature("earthquakes", (emsc ? "emsc-" : "") + f.id, f.geometry, {
    title: p.place || p.flynn_region || "Earthquake",
    severity: numeric(p.mag),
    depth: numeric(emsc ? p.depth : f.geometry.coordinates[2]),
    timestamp: utc(p.time),
    source: emsc ? "EMSC" : "USGS",
    source_url: emsc
      ? "https://www.seismicportal.eu/eventdetails.html?unid=" +
        encodeURIComponent(p.unid || f.id)
      : safeLink(p.url, "https://earthquake.usgs.gov/"),
    magnitude_type: p.magType || p.magtype,
  });
}
export function slick(f) {
  const p = f.properties;
  return feature("oil", p.id ?? f.id, f.geometry, {
    title: "Potential oil slick",
    severity: numeric(p.slick_confidence),
    confidence: numeric(p.slick_confidence),
    timestamp: utc(p.slick_timestamp),
    area_km2: numeric(p.area) === null ? null : p.area / 1e6,
    scene: p.s1_scene_id,
    source: "SkyTruth Cerulean",
    source_url: safeLink(p.slick_url, "https://cerulean.skytruth.org"),
    classification: p.hitl_cls_name || null,
    likely_source:
      {
        3: "Natural",
        4: "Infrastructure",
        5: "Vessel",
        6: "Vessel",
        7: "Vessel",
        8: "Vessel",
      }[p.hitl_cls] || null,
  });
}
export function fire(p) {
  const time = String(p.acq_time).padStart(4, "0");
  const timestamp = utc(
    p.acq_date + "T" + time.slice(0, 2) + ":" + time.slice(2) + ":00Z",
  );
  const id = [p.satellite, p.latitude, p.longitude, p.acq_date, time].join("/");
  return feature("fires", id, point(p.longitude, p.latitude), {
    title: "Thermal detection",
    industrial_reason:industrialReason(+p.longitude,+p.latitude,p.type),
    severity: numeric(p.frp),
    timestamp,
    confidence: p.confidence || null,
    satellite: p.satellite,
    instrument:
      p.instrument ||
      (p.satellite === "Terra" || p.satellite === "Aqua" ? "MODIS" : "VIIRS"),
    source: "NASA FIRMS",
    source_url:
      "https://firms.modaps.eosdis.nasa.gov/map/#d:" +
      p.acq_date +
      ";@" +
      p.longitude +
      "," +
      p.latitude +
      ",10z",
  });
}
async function globalEarthquakes(start, end) {
  const q = {
    format: "geojson",
    starttime: start,
    endtime: addDays(end, 1),
    minlongitude: 32,
    maxlongitude: 60,
    minlatitude: 12,
    maxlatitude: 33,
    eventtype: "earthquake",
    orderby: "time",
    limit: 20000,
  };
  try {
    const data = await json(params(USGS, q));
    return {
      features: data.features.map((f) => quake(f)),
      provider: "USGS",
      partial:
        data.features.length === 20000 ? "USGS record limit reached." : "",
    };
  } catch {
    try {
      const data = await json(
        params("https://www.seismicportal.eu/fdsnws/event/1/query", {
          ...q,
          format: "json",
          limit: 10000,
        }),
      );
      return {
        features: data.features.map((f) => quake(f, true)),
        provider: "EMSC",
        partial: "USGS unavailable. Showing the EMSC catalogue.",
      };
    } catch {
      const data = await json(
        "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.geojson",
      );
      return {
        features: data.features
          .filter(
            (f) =>
              inside(f.geometry.coordinates) &&
              f.properties.type === "earthquake",
          )
          .map((f) => quake(f)),
        provider: "USGS monthly feed",
        partial: "Catalogue service unavailable. Monthly feed coverage only.",
      };
    }
  }
}
export async function earthquakes(start,end){
  if(profile==="commercial")return globalEarthquakes(start,end);
  const [world,sa]=await Promise.allSettled([globalEarthquakes(start,end),sgsEvents(start,end)]);
  if(world.status==="rejected" && sa.status==="rejected")throw Error("Provider earthquake catalogues unavailable.");
  if(world.status==="rejected")return {...sa.value,partial:"Global sources unavailable. SGS catalogue only."};
  if(sa.status==="rejected")return {...world.value,partial:[world.value.partial,"SGS catalogue unavailable."].filter(Boolean).join(" ")};
  return {provider:world.value.provider+" · SGS",features:mergeSeismic(world.value.features,sa.value.features),partial:[world.value.partial,sa.value.partial].filter(Boolean).join(" ")};
}
export async function oil(start, end) {
  const features = [];
  const page = 200;
  const cap=Math.min(20000,Math.max(page,parseInt(process.env.CERULEAN_MAX_FEATURES,10)||3000));
  let more = true;
  const headers = process.env.CERULEAN_TOKEN
    ? { Authorization: "Bearer " + process.env.CERULEAN_TOKEN }
    : {};
  for (let offset = 0; more && offset < cap; offset += page) {
    const limit=Math.min(page,cap-offset);
    const u = params(CER + "public.slick_plus/items", {
      f: "geojson",
      bbox: BOX.join(","),
      datetime: start + "T00:00:00Z/" + end + "T23:59:59Z",
      filter: "machine_confidence >= 0.7 AND max_source_collated_score >= 0",
      properties:
        "id,slick_timestamp,s1_scene_id,area,slick_confidence,hitl_cls,hitl_cls_name,slick_url",
      sortby: "-slick_timestamp,id",
      limit,
      offset,
      utm_source: "gulfhazard-monitor",
    });
    const data = await json(u, { headers });
    features.push(...data.features.map(slick));
    more =
      data.features.length === limit &&
      (data.numberMatched == null || features.length < data.numberMatched);
  }
  return {
    features,
    partial: more
      ? "Result capped at "+cap.toLocaleString("en-US")+" polygons. Narrow the date range."
      : "",
  };
}
export async function fires(start, end) {
  let features = [],
    partial = "",
    coverage = [start, end];
  const minimum = addDays(day(Date.now()), -7);
  const key = process.env.FIRMS_MAP_KEY;
  if (key) {
    const span =
      Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
    const cap=Math.max(1,Math.min(366,parseInt(process.env.FIRMS_MAX_DAYS,10)||30));
    const first = span > cap ? addDays(end, 1-cap) : start;
    coverage = [first, end];
    if (span > cap)
      partial =
        "FIRMS history limited to the last "+cap+" requested days per query.";
    const sources = (process.env.FIRMS_PRODUCTS || "VIIRS_NOAA20_NRT,MODIS_NRT")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^[A-Z0-9_]+$/.test(s));
    let successes=0, lastFailure;
    for (let d = first; d <= end; d = addDays(d, 5)) {
      const n = Math.min(
        5,
        1 + Math.round((Date.parse(end) - Date.parse(d)) / 86400000),
      );
      for (const source of sources) {
        try {
          features.push(
            ...(await getCsv(
              FIRMS +
                "/api/area/csv/" +
                encodeURIComponent(key) +
                "/" +
                source +
                "/" +
                BOX.join(",") +
                "/" +
                n +
                "/" +
                d,
            )),
          );
          successes++;
        } catch (e) {
          lastFailure=e;
          partial = "Some FIRMS products or date segments were unavailable.";
        }
      }
    }
    if(!successes)throw lastFailure||Error("FIRMS did not return a detection table.");
  } else {
    if (end < minimum)
      throw Error(
        "Historical FIRMS queries require FIRMS_MAP_KEY on the server.",
      );
    features = await getCsv(
      FIRMS +
        "/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Russia_Asia_7d.csv",
    );
    coverage = [start < minimum ? minimum : start, end];
    if (start < minimum)
      partial = "Public NOAA-20 feed covers the most recent seven days.";
  }
  return { features, partial, coverage };
}
async function getCsv(url) {
  const body = await (await request(url)).text();
  if (!body.split("\n", 1)[0].includes("latitude"))
    throw Error(
      "FIRMS did not return a detection table. Check product availability and MAP_KEY.",
    );
  return parse(body, { columns: true, skip_empty_lines: true, bom: true })
    .filter((p) => inside([+p.longitude, +p.latitude]))
    .map(fire);
}
export async function sourceClass(id) {
  if (!/^\d+$/.test(id)) throw Error("Invalid slick ID.");
  const data = await json(
    params(CER + "public.source_plus/items", {
      f: "geojson",
      filter: "slick_id = " + id + " AND source_collated_score > 0",
      properties: "source_type,source_collated_score",
      limit: 50,
      "bbox-only": true,
    }),
  );
  return [
    ...new Set(
      data.features.map((f) => String(f.properties.source_type || "Unknown")),
    ),
  ];
}
