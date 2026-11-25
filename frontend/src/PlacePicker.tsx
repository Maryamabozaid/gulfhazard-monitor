import { useMemo, useState } from "react";
import { bbox } from "@turf/turf";
import { LocateFixed, Search, X } from "lucide-react";
import { fmt, useStore, useText } from "./model";
import type { MapApi } from "./gis/mapApi";
import { cityRadius, gccIds, wholeGulfIds, normalizeName, type Bounds, type PlaceFilterState, type PlaceKind } from "./gis/placeFilter";

const kinds = {
  all:["All","الكل"], country:["Countries","دول"], region:["Regions","مناطق ومحافظات"], city:["Cities","مدن وبلدات"], sea:["Waters","مياه"],
} as const;
const kindsSingular = {country:["Country","دولة"], region:["Region","منطقة إدارية"], city:["City","مدينة أو بلدة"], sea:["Sea","مسطح بحري"]} as const;

export function PlacePicker({filter, count, api}: {filter:PlaceFilterState; count:number; api:MapApi|null}) {
  const {placeIds, lang, patch} = useStore();
  const ar = lang === "ar", t = useText();
  const [query,setQuery] = useState(""), [kind,setKind] = useState<PlaceKind|"all">("all"), [limit,setLimit] = useState(35);
  const [parent,setParent] = useState("");
  const {catalogue, error, areas} = filter;
  const withinCountry = kind==="region" || kind==="city";
  const found = useMemo(() => {
    const term = normalizeName(query);
    const list = (catalogue?.places ?? []).filter(p => (kind === "all" || p.kind === kind)
      && (!withinCountry || !parent || p.country===parent) && (!term || p.terms.some(s=>s.includes(term))));
    if (term) {
      const score = (terms:string[]) => terms.includes(term) ? 0 : terms.some(s=>s.startsWith(term)) ? 1 : 2;
      list.sort((a,b) => score(a.terms)-score(b.terms));
    }
    return list;
  }, [catalogue,query,kind,withinCountry,parent]);
  function toggle(id:string) {
    patch({placeIds:placeIds.includes(id) ? placeIds.filter(i=>i!==id) : [...placeIds,id], selected:null});
  }
  function preset(ids:string[], name:string) {
    const on = ids.every(id=>placeIds.includes(id));
    return <button type="button" aria-pressed={on} disabled={!catalogue} onClick={()=>{
      patch({placeIds:on ? placeIds.filter(id=>!ids.includes(id)) : [...new Set([...placeIds,...ids])],selected:null});
    }}>{name}</button>;
  }
  return <div className="place-picker">
    <label className="place-query"><Search size={16} aria-hidden="true"/><input type="search" autoFocus
      aria-label={t("Search countries, regions or cities","ابحثي عن دولة أو منطقة أو مدينة")}
      placeholder={t("Search countries, regions or cities","ابحثي عن دولة أو منطقة أو مدينة")}
      value={query} onChange={e=>{setQuery(e.target.value);setLimit(35);}} /></label>
    <div className="place-kinds place-presets" role="group" aria-label={t("Gulf selections","اختيارات الخليج")}>
      {preset(wholeGulfIds,t("Whole Arabian Gulf","الخليج العربي كله"))}
      {preset(gccIds,t("GCC countries","دول مجلس التعاون"))}
    </div>
    <div className="place-kinds" role="group" aria-label={t("Place type","نوع المكان")}>
      {(Object.keys(kinds) as (keyof typeof kinds)[]).map(key=><button key={key} aria-pressed={kind===key}
        onClick={()=>{setKind(key);setLimit(35);}}>{kinds[key][ar?1:0]}</button>)}
    </div>
    {withinCountry && catalogue && <label>{t("Search within country","البحث داخل دولة")}
      <select value={parent} onChange={e=>{setParent(e.target.value);setLimit(35);}}>
        <option value="">{t("All countries","كل الدول")}</option>
        {catalogue.places.filter(p=>p.kind==="country").map(p=><option key={p.id} value={p.country}>{ar?p.ar:p.name}</option>)}
      </select></label>}
    {placeIds.length>0 && <div className="place-selections">
      {placeIds.map(id=>{
        const p=catalogue?.byId.get(id), name=p ? (ar?p.ar:p.name) : id;
        return <button key={id} aria-label={t("Remove ","إزالة ")+name} onClick={()=>toggle(id)}>{name}<X size={12}/></button>;
      })}
      <button className="place-clear" onClick={()=>patch({placeIds:[],selected:null})}>{t("Clear all","مسح الكل")}</button>
    </div>}
    {!catalogue ? <p role="status">{error ? <>{t("Place directory unavailable.","تعذر تحميل دليل الأماكن.")} <button onClick={filter.retry}>{t("Retry","إعادة المحاولة")}</button></> : t("Loading places…","جارٍ تحميل الأماكن…")}</p> :
      <div className="place-results" role="group" aria-label={t("Matching places","الأماكن المطابقة")}>
        {found.slice(0,limit).map(p=>{
          const parent = catalogue.byId.get("country:"+p.country);
          return <label key={p.id}><input type="checkbox" value={p.id} checked={placeIds.includes(p.id)} onChange={()=>toggle(p.id)}/>
            <span><strong>{ar?p.ar:p.name}</strong><small>{kindsSingular[p.kind][ar?1:0]}
              {p.kind!=="country" && parent && " · "+(ar?parent.ar:parent.name)}
              {p.kind==="city" && " · "+t("25 km radius","نطاق ٢٥ كم")}</small></span></label>;
        })}
        {!found.length && <p role="status">{t("No matching places. Try another spelling.","مفيش مكان مطابق. جرّبي كتابة الاسم بطريقة تانية.")}</p>}
        {found.length>limit && <button className="place-more" onClick={()=>setLimit(n=>n+35)}>{t("Show more places","عرض أماكن أكتر")}</button>}
      </div>}
    <small>{t("Whole Arabian Gulf includes its waters and all eight coastal countries. Cities use a "+cityRadius+" km radius. Observations follow the monitoring extent.",
      "الخليج كله يشمل مياهه والدول الثماني المطلة عليه. نطاق المدينة ٢٥ كم من المركز. الأرصاد حسب تغطية المنصة.")}</small>
    {placeIds.length>0 && catalogue && <div className="place-summary">
      <strong role="status">{t("Observations in any selected place","الأرصاد في أيّ من الأماكن المحددة")} · {fmt(count,ar)}</strong>
      <button disabled={!api || !areas.features.length} onClick={()=>{
        api?.fitArea(bbox(areas) as Bounds);patch({tool:null});
      }}><LocateFixed size={15}/>{t("Show on map","عرض على الخريطة")}</button>
    </div>}
  </div>;
}
