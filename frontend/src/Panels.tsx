import {ProviderHealth} from "./ProviderHealth";
import cadence from "../../shared/cadence.json";
import { ImpactReference } from "./ImpactReference";
import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import {
  area,
  bbox,
  booleanIntersects,
  buffer,
  centroid,
  point,
} from "@turf/turf";
import {
  X,
  ChevronRight,
  ChevronDown,
  SlidersHorizontal,
  Check,
  Search,
  ExternalLink,
  Download,
  MapPin,
  Square,
  Hexagon,
  Circle,
  Trash2,
  Bookmark,
  Plus,
  LocateFixed,
} from "lucide-react";
import { Icon } from "./icons";
import {
  useStore,
  useText,
  fmt,
  byId,
  layers,
  initialSetting,
  day,
  dateText,
  ago,
  measureText,
  type Payload,
  type Hazard,
  type Tool,
} from "./model";
import { loadLabels, loadMapLabels } from "./gis/cartography";
import { ImageryPanel } from "./ImageryPanel";
import { type MapApi } from "./gis/MapView";
import { SourceRows } from "./Feed";
import { Alerts } from "./Alerts";
import { PlacePicker } from "./PlacePicker";
import type { PlaceFilterState } from "./gis/placeFilter";
import { download, exportFile, visibleRecords } from "./export";
const Stats = lazy(() => import("./Stats").then((m) => ({ default: m.Stats })));
export const toolNames: Record<string, [string, string]> = {
  places: ["Filter places", "فلترة الأماكن"],
  search: ["Search places", "بحث الأماكن"],
  layers: ["Map layers", "طبقات الخريطة"],
  basemap: ["Basemaps", "خرائط الأساس"],
  draw: ["Area of interest", "منطقة الاهتمام"],
  measure: ["Measure", "القياس"],
  satellite: ["Satellite imagery", "صور الأقمار"],
  time: ["Time window", "الفترة الزمنية"],
  alerts: ["Alert rules", "قواعد التنبيه"],
  export: ["Export map & data", "تصدير الخريطة والبيانات"],
  info: ["Data sources", "مصادر البيانات"],
  stats: ["Statistics", "الإحصاءات"],
  projects: ["Saved projects", "المشاريع المحفوظة"],
  about: ["About GulfHazard", "عن المنصة"],
  contact: ["Contact", "التواصل"],
  risk: ["Regional exposure", "التعرض الإقليمي"],
};
export function Settings({ id, close }: { id: string; close: () => void }) {
  const s = useStore(),
    t = useText(),
    ar = s.lang === "ar",
    v = { ...initialSetting, ...s.settings[id] },
    l = byId[id];
  return (
    <div className="settings stack" role="dialog" aria-label={l.name}>
      {id==="fires"&&<label><input type="checkbox" checked={v.excludeIndustrial!==false} onChange={e=>s.setting(id,{excludeIndustrial:e.target.checked})}/> {t("Filter known static and industrial heat","استبعاد المصادر الحرارية الثابتة والصناعية المعروفة")}</label>}
      <div className="row between">
        <strong className="row">
          <Icon name={id} style={{ color: l.color }} />
          {ar ? l.ar : l.name}
        </strong>
        <button
          className="iconbtn"
          onClick={close}
          aria-label={t("Close settings", "إغلاق الإعدادات")}
        >
          <X size={16} />
        </button>
      </div>
      <label>
        {t("Opacity", "العتامة")}{" "}
        <span className="float-end">{Math.round(v.opacity * 100)}%</span>
        <input
          type="range"
          min="0"
          max="1"
          step=".05"
          value={v.opacity}
          onChange={(e) => s.setting(id, { opacity: +e.target.value })}
        />
      </label>
      <div className="two">
        <label>
          {t("From", "من")}
          <input
            type="date"
            value={v.start || s.range.start}
            max={v.end || s.range.end}
            onChange={(e) => s.setting(id, { start: e.target.value })}
          />
        </label>
        <label>
          {t("Through", "إلى")}
          <input
            type="date"
            min={v.start || s.range.start}
            max={ago(0)}
            value={v.end || s.range.end}
            onChange={(e) => s.setting(id, { end: e.target.value })}
          />
        </label>
      </div>
      <label>
        {ar ? l.metricAr : l.metric} ≥
        <input
          type="number"
          step="any"
          placeholder={t("Any value", "أي قيمة")}
          value={v.min}
          onChange={(e) => s.setting(id, { min: e.target.value })}
        />
      </label>
      <div className="layer-key">
        <span style={{ background: l.color }} />
        {id === "earthquakes"
          ? t(
              "Size = magnitude · colour = depth",
              "الحجم = القوة · اللون = العمق",
            )
          : id === "oil"
            ? t(
                "Darker fill = higher geometric confidence",
                "لون أغمق = ثقة هندسية أعلى",
              )
            : id === "fires"
              ? t(
                  "Amber to red = increasing FRP",
                  "كهرماني إلى أحمر = قدرة إشعاع أعلى",
                )
              : ar
                ? l.metricAr
                : l.metric}
      </div>
      <button
        className="secondary"
        onClick={() => s.setting(id, initialSetting)}
      >
        {t("Reset layer settings", "استعادة الإعدادات")}
      </button>
    </div>
  );
}
type Props = {
  placeFilter: PlaceFilterState;
  api: MapApi | null;
  records: Hazard[];
  data: Record<string, Payload>;
  measure: string;
  onMeasure: (v: string) => void;
  settings: (id: string) => void;
  onSelect: (f: Hazard) => void;
};
export function Panels(props: Props) {
  const s = useStore(),
    { tool, patch } = s,
    t = useText(),
    ar = s.lang === "ar";
  if (!tool) return null;
  const name = toolNames[tool];
  return (
    <section
      role="dialog"
      aria-label={t(...name)}
      className={
        "tool-panel glass " +
        (["info", "stats", "about"].includes(tool) ? "wide" : "")
      }
    >
      <div className="panel-head">
        <span className="panel-icon">
          <Icon name={tool} size={17} />
        </span>
        <h2>{t(...name)}</h2>
        <button
          className="iconbtn"
          aria-label={t("Close panel", "إغلاق اللوحة")}
          onClick={() => patch({ tool: null, sketch: null })}
        >
          <X size={17} />
        </button>
      </div>
      <div className="panel-body">
        {tool==="places" ? <PlacePicker filter={props.placeFilter} api={props.api} count={props.records.length}/> :
          <Contents key={tool} {...props} tool={tool} />}
      </div>
    </section>
  );
}
function Contents({
  tool,
  placeFilter,
  api,
  records,
  data,
  measure,
  onMeasure,
  settings,
  onSelect,
}: Props & { tool: Exclude<Tool, null> }) {
  const s = useStore(),
    t = useText(),
    ar = s.lang === "ar",
    [query, setQuery] = useState(""),
    [msg, setMsg] = useState(""),
    [format, setFormat] = useState("geojson"),
    [busy, setBusy] = useState(false),
    [labels, setLabels] = useState<any[]>([]),
    [start, setStart] = useState(s.range.start),
    [end, setEnd] = useState(s.range.end),
    [bufferKm, setBuffer] = useState(10),
    [projects, setProjects] = useState<any[]>(() => {
      try {
        return JSON.parse(localStorage.getItem("gh-projects") || "[]");
      } catch {
        return [];
      }
    });
  useEffect(() => {
    if (tool === "search")
      loadMapLabels()
        .then((l) => setLabels(l.features))
        .catch(() =>
          setMsg(t("Place index unavailable.", "فهرس الأماكن غير متاح.")),
        );
  }, [tool]);
  const subset = useMemo(
    () =>
      tool === "draw" && s.aoi
        ? records.filter((f) => booleanIntersects(f, s.aoi!))
        : [],
    [s.aoi, records, tool],
  );
  const perform = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg("");
    try {
      await fn();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const status = (
    <>
      {busy && <p role="status">{t("Working…", "جار التنفيذ…")}</p>}
      {msg && (
        <p role="status" className="notice">
          {msg}
        </p>
      )}
    </>
  );
  if (tool === "search") {
    const normalize = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
    const term=normalize(query);
    const places = labels
      .filter(
        (f) =>
          query &&
          [f.properties.name, f.properties.ar].some((v) =>
            v && normalize(v).includes(term),
          ),
      )
      .sort((a,b) => Number([b.properties.name,b.properties.ar].some(n=>n && normalize(n)===term))-Number([a.properties.name,a.properties.ar].some(n=>n && normalize(n)===term)))
      .slice(0, 12);
    const coords = query
      .trim()
      .match(/^(-?\d+(?:\.\d+)?)\s*[,، ]\s*(-?\d+(?:\.\d+)?)$/);
    const go = (p: [number, number], zoom=12) => {
      api?.map.flyTo({ center: p, zoom });
      s.patch({ tool: null });
    };
    return (
      <div className="stack">
        <label>
          {t("Place or coordinates", "اسم المكان أو الإحداثيات")}
          <input
            autoFocus
            placeholder={t("Riyadh or 24.71, 46.68", "الرياض أو 24.71, 46.68")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {coords &&
          Math.abs(+coords[1]) <= 85 &&
          Math.abs(+coords[2]) <= 180 && (
            <button
              className="listrow"
              onClick={() => go([+coords[2], +coords[1]])}
            >
              <LocateFixed size={16} />
              {coords[1]}, {coords[2]}
            </button>
          )}
        {places.map((f) => (
          <button
            className="listrow"
            key={f.id || f.properties.name + f.geometry.coordinates.join(",")}
            onClick={() => go(f.geometry.coordinates, f.properties.kind === "country" ? 5 : f.properties.kind === "sea" ? 6 : 13)}
          >
            <MapPin size={16} />
            <b>{ar ? f.properties.ar || f.properties.name : f.properties.name}</b>
          </button>
        ))}
        {query && !places.length && !coords && (
          <p>
            {t(
              "No regional place matched. Try latitude, longitude.",
              "لا يوجد مكان مطابق. جرّب خط العرض والطول.",
            )}
          </p>
        )}
        {status}
      </div>
    );
  }
  if (tool === "layers")
    return (
      <div>
        {layers.map((l) => (
          <div className="layerrow" key={l.id}>
            <Icon name={l.id} style={{ color: l.color }} />
            <label>
              <input
                type="checkbox"
                checked={s.active.includes(l.id)}
                onChange={() => s.toggle(l.id)}
                disabled={!!s.restrictions[l.id]}
              />
              {ar ? l.ar : l.name}
            </label>
            <button
              className="iconbtn"
              aria-label={l.name + " " + t("settings", "إعدادات")}
              onClick={() => settings(l.id)}
            >
              <SlidersHorizontal size={14} />
            </button>
          </div>
        ))}
      </div>
    );
  if (tool === "basemap")
    return (
      <div className="base-grid">
        {[
          ["light", "Light", "فاتحة"],
          ["dark", "Dark", "داكنة"],
          ["satellite", "Satellite", "قمر صناعي"],
          ["terrain", "Terrain", "تضاريس"],
          ["vector", "Vector streets", "شوارع متجهة"],
        ].filter(([id])=>s.profile!=="commercial"||!["satellite","terrain"].includes(id)).map(([id, en, arab]) => (
          <button
            key={id}
            className={s.base === id ? "chosen" : ""}
            onClick={() => s.patch({ base: id })}
          >
            <div className={"base-swatch " + id} />
            <span>
              {t(en, arab)}
              {s.base === id && <Check size={14} />}
            </span>
          </button>
        ))}
      </div>
    );
  if (tool === "draw" || tool === "measure") {
    const draw = tool === "draw",
      opts = draw
        ? [
            ["polygon", "Polygon", "مضلع"],
            ["rectangle", "Rectangle", "مستطيل"],
            ["circle", "Circle", "دائرة"],
          ]
        : [
            ["distance", "Distance", "مسافة"],
            ["area", "Area", "مساحة"],
          ];
    return (
      <div className="stack">
        <div className="actions">
          {opts.map(([id, en, arab]) => (
            <button
              key={id}
              className={s.sketch === id ? "chosen" : ""}
              onClick={() => {
                s.patch({ sketch: id, aoi: draw ? null : s.aoi });
                onMeasure("");
              }}
            >
              {t(en, arab)}
            </button>
          ))}
        </div>
        {s.sketch && (
          <>
            <p>
              {["circle", "rectangle"].includes(s.sketch)
                ? t(
                    "Click the map twice to set the shape.",
                    "انقر مرتين على الخريطة لتحديد الشكل.",
                  )
                : t(
                    "Click to add vertices, then finish the shape.",
                    "انقر لإضافة نقاط ثم أكمل الشكل.",
                  )}
            </p>
            <button className="primary" onClick={() => api?.finish()}>
              {t("Finish drawing", "إكمال الرسم")}
            </button>
          </>
        )}
        {measure && <strong>{measure}</strong>}
        {draw && s.aoi && (
          <>
            <div className="kpis">
              <div>
                <b>{fmt(subset.length, ar)}</b>
                <small>{t("observations", "مشاهدات")}</small>
              </div>
              <div>
                <b>{fmt(area(s.aoi) / 1e6, ar)}</b>
                <small>km²</small>
              </div>
            </div>
            {s.active.map((id) => {
              const list = subset.filter((f) => f.properties.type === id),
                top = [...list].sort(
                  (a, b) =>
                    (b.properties.severity ?? -Infinity) -
                    (a.properties.severity ?? -Infinity),
                )[0];
              return (
                <div className="listrow" key={id}>
                  <span>
                    {ar ? byId[id].ar : byId[id].name} · {list.length}
                  </span>
                  {top && (
                    <button onClick={() => onSelect(top)}>
                      {measureText(top)}
                    </button>
                  )}
                </div>
              );
            })}
            <details>
              <summary>{t("Daily timeline", "الخط الزمني اليومي")}</summary>
              {Object.entries(
                subset.reduce<Record<string, number>>((d, f) => {
                  const k =
                    f.properties.timestamp?.slice(0, 10) ||
                    t("Inventory", "جرد");
                  d[k] = (d[k] || 0) + 1;
                  return d;
                }, {}),
              )
                .sort()
                .map(([d, n]) => (
                  <div className="listrow" key={d}>
                    {d}
                    <b>{n}</b>
                  </div>
                ))}
            </details>
            <label>
              {t("Buffer distance (km)", "مسافة النطاق (كم)")}
              <input
                type="number"
                value={bufferKm}
                min=".1"
                max="500"
                onChange={(e) => setBuffer(+e.target.value)}
              />
            </label>
            <button
              disabled={!(bufferKm > 0 && bufferKm <= 500)}
              onClick={() => {
                const a = buffer(s.aoi!, bufferKm);
                if (a) s.patch({ aoi: a as any });
              }}
            >
              {t("Apply buffer", "تطبيق النطاق")}
            </button>
          </>
        )}
        <button
          className="secondary"
          onClick={() => {
            s.patch({ aoi: null, sketch: null });
            api?.clearDrawing();
            onMeasure("");
          }}
        >
          {t("Clear drawing", "مسح الرسم")}
        </button>
      </div>
    );
  }
  if(tool==="satellite")return <ImageryPanel api={api}/>;
  if (tool === "time")
    return (
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (Date.parse(end) - Date.parse(start) > 365 * 864e5) {
            setMsg(t("Select up to one year.", "اختر سنة واحدة كحد أقصى."));
            return;
          }
          s.patch({ range: { start, end }, period: 0, cursor: 1, tool: null });
        }}
      >
        <label>
          {t("Start date (UTC)", "تاريخ البدء")}
          <input
            type="date"
            required
            value={start}
            max={end}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          {t("End date (UTC)", "تاريخ الانتهاء")}
          <input
            type="date"
            required
            min={start}
            max={ago(0)}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <button className="primary">
          {t("Apply time window", "تطبيق الفترة")}
        </button>
        {status}
      </form>
    );
  if (tool === "export")
    return (
      <div className="stack">
        <p>
          {api ? fmt(visibleRecords(api, records, s.aoi).length, ar) : 0}{" "}
          {t("records in the current view", "سجل ضمن العرض الحالي")}
          {s.aoi ? " · AOI" : ""}
        </p>
        <label>
          {t("File format", "صيغة الملف")}
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            {[
              ["geojson", "GeoJSON"],
              ["csv", "CSV"],
              ["shp", "Shapefile (.zip)"],
              ["png", "Map PNG"],
              ["pdf", "Map PDF"],
            ].map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary"
          disabled={!api || busy}
          onClick={() =>
            perform(async () => {
              await exportFile(
                format,
                api!,
                records,
                s.aoi,
                "Natural Earth · GeoNames · Mapzen · " + (s.profile==="research"?"Esri · ":"") +
                  (s.imagery?.attribution || "") +
                  " · " +
                  s.active
                    .map((id) => data[id]?.provider || byId[id].source)
                    .join(" / "),
              );
              setMsg(t("Download prepared.", "تم تجهيز التنزيل."));
            })
          }
        >
          <Download size={16} />
          {t("Export file", "تصدير الملف")}
        </button>
        {status}
      </div>
    );
  if (tool === "alerts") return <Alerts />;
  if (tool === "stats")
    return (
      <>
        <p className="caption">
          {start} — {end} UTC · {t("Active layers", "الطبقات النشطة")}
        </p>
        <Suspense fallback={<p>…</p>}>
          <Stats records={records} />
        </Suspense>
      </>
    );
  if (tool === "risk") return <Exposure api={api} records={records} feeds={data} matches={placeFilter.matches} />;
  if (tool === "info")
    return (
      <div className="stack">
        <ProviderHealth/>
        {s.profile&&<small>{t("Data profile","نسخة البيانات")} · {s.profile==="commercial"?t("Commercial","تجارية"):t("Research","بحثية")}</small>}
        <SourceRows data={data} />
        {layers.map((l) => (
          <details key={l.id}>
            <summary>
              <Icon name={l.id} size={15} style={{ color: l.color }} />
              {ar ? l.ar : l.name}
            </summary>
            <p>
              {l.source} ·{" "}
              {(cadence as Record<string, string[]>)[l.id]?.[ar ? 1 : 0]} ·{" "}
              {t("Cache interval", "مدة التخزين")} {l.ttl / 60} min
            </p>
            {l.edition && <p>{l.edition}</p>}
            {l.method && <p>{l.method}</p>}
            <small>{l.license}</small>
            {s.restrictions[l.id]&&<p>{t("Excluded in this distribution","مستبعد من هذه النسخة")} · {s.restrictions[l.id]}</p>}
            <a href={l.url} target="_blank" rel="noreferrer">
              {t("Provider documentation", "وثائق المصدر")}{" "}
              <ExternalLink size={12} />
            </a>
          </details>
        ))}
        <details>
          <summary>{t("Satellite imagery services","خدمات صور الأقمار الصناعية")}</summary>
          <p>{t("NASA GIBS serves daily and instrument-specific visualizations. Credit NASA and the product science team.","تقدم NASA GIBS مرئيات يومية ومنتجات حسب المستشعر. تُنسب البيانات إلى ناسا والفريق العلمي.")}</p>
          <a href="https://nasa-gibs.github.io/gibs-api-docs/" target="_blank" rel="noreferrer">NASA GIBS</a>
          <p>{t("Copernicus Sentinel data follow the Sentinel data terms. Scenes become available after acquisition and processing.","تخضع بيانات كوبرنيكوس سنتينل لشروط بيانات سنتينل. تتاح المشاهد بعد الالتقاط والمعالجة.")}</p>
          <a href="https://documentation.dataspace.copernicus.eu/" target="_blank" rel="noreferrer">Copernicus Data Space</a>
          <p>{t("Planetary Computer indexes Sentinel and Landsat acquisitions. Each STAC collection carries the publisher’s license.","يفهرس Planetary Computer مشاهد سنتينل ولاندسات. يتضمن كل فهرس STAC ترخيص الناشر.")}</p>
          <a href="https://planetarycomputer.microsoft.com/catalog" target="_blank" rel="noreferrer">Microsoft Planetary Computer</a>
        </details>
        <a href="/cartography/SOURCES.md" target="_blank">
          {t("Basemap credits", "مصادر خريطة الأساس")}
        </a>
      </div>
    );
  if (tool === "projects")
    return (
      <div className="stack">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!query.trim() || !api) return;
            const p = {
              name: query.trim(),
              id: crypto.randomUUID(),
              saved: Date.now(),
              center: api.map.getCenter().toArray(),
              zoom: api.map.getZoom(),
              view: {
                active: s.active,
                placeIds: s.placeIds,
                range: s.range,
                settings: s.settings,
                period: s.period,
                aoi: s.aoi,
                base: s.base,
              },
            };
            const next = [p, ...projects].slice(0, 40);
            localStorage.setItem("gh-projects", JSON.stringify(next));
            setProjects(next);
            setQuery("");
          }}
        >
          <input
            aria-label={t("Project name", "اسم المشروع")}
            placeholder={t("Name this map view", "اسم عرض الخريطة")}
            value={query}
            maxLength={80}
            onChange={(e) => setQuery(e.target.value)}
            required
          />
          <button className="primary">{t("Save", "حفظ")}</button>
        </form>
        {!projects.length && (
          <p>
            {t(
              "Save the current map, layers and date window on this device.",
              "احفظ الخريطة والطبقات والفترة على هذا الجهاز.",
            )}
          </p>
        )}
        {projects.map((p) => (
          <div className="listrow" key={p.id}>
            <button
              onClick={() => {
                s.patch({ ...p.view, placeIds:p.view.placeIds ?? [], selected:null, tool: null, cursor: 1 });
                api?.map.flyTo({ center: p.center, zoom: p.zoom });
              }}
            >
              <Bookmark size={14} /> {p.name}
            </button>
            <button
              className="iconbtn"
              aria-label={t("Delete saved view", "حذف العرض المحفوظ")}
              onClick={() => {
                const next = projects.filter((v) => v.id !== p.id);
                setProjects(next);
                localStorage.setItem("gh-projects", JSON.stringify(next));
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    );
  if (tool === "contact")
    return (
      <div className="stack">
        <p>
          {t(
            "For questions about an observation, contact the agency that published it. Include its event ID and acquisition time.",
            "للاستفسار عن مشاهدة، تواصل مع الوكالة الناشرة واذكر معرف الحدث ووقت الالتقاط.",
          )}
        </p>
        {[
          ["USGS", "https://www.usgs.gov/connect/contact-us"],
          ["SkyTruth", "https://skytruth.org/contact/"],
          ["NASA FIRMS", "https://www.earthdata.nasa.gov/contact"],
        ].map(([n, u]) => (
          <a
            className="listrow"
            key={n}
            href={u}
            target="_blank"
            rel="noreferrer"
          >
            {n}
            <ExternalLink size={14} />
          </a>
        ))}
      </div>
    );
  return (
    <div className="stack">
      <div className="about-brand">
        <img src="/mark.svg" width="44" alt="" />
        <strong>GulfHazard Monitor</strong>
      </div>
      <p>
        {t(
          "Explore environmental observations across Saudi Arabia, the Arabian Peninsula and adjoining seas. The map combines earthquake catalogues, satellite detections, regional inventories and probabilistic hazard models.",
          "استكشف المشاهدات البيئية في السعودية وشبه الجزيرة العربية والبحار المجاورة. تجمع الخريطة سجلات الزلازل والرصد الفضائي والجرد الإقليمي ونماذج الأخطار الاحتمالية.",
        )}
      </p>
      <p>
        {t(
          "Each observation links to its publisher. Source status shows availability, coverage and the last successful fetch.",
          "ترتبط كل مشاهدة بالناشر. تعرض حالة المصدر مدى التوفر والتغطية وآخر جلب ناجح.",
        )}
      </p>
      <button onClick={() => s.patch({ tool: "info" })}>
        {t("Data sources & credits", "المصادر والاعتمادات")}
      </button>
    </div>
  );
}
function Exposure({ api, records, feeds, matches }: { api: MapApi | null; records: Hazard[]; feeds:Record<string,Payload>; matches:PlaceFilterState["matches"] }) {
  const quakes=feeds.earthquakes;
  const t = useText(),
    { active, range,settings,cursor,period } = useStore(),
    [metric,setMetric]=useState("historic"),
    [reference,setReference]=useState<number[][]|null>(null),
    [scope, setScope] = useState("ports"),
    [cells, setCells] = useState<Hazard[]>([]),
    [msg, setMsg] = useState("");
  useEffect(()=>{let live=true;fetch("/cartography/exposure-reference.json").then(r=>{if(!r.ok)throw Error();return r.json();}).then(r=>{if(live)setReference(r.events);}).catch(()=>{if(live)setMsg("USGS reference catalogue unavailable.");});return()=>{live=false;};},[]);
  useEffect(() => {
    let open = true;
    if (scope === "cities") {
      loadLabels()
        .then((data) => {
          if (!open) return;
          setCells(
            data.features
              .filter((f) => {
                const [x, y] = f.geometry.coordinates;
                return (
                  f.properties?.kind === "city" &&
                  x >= 32 &&
                  x <= 60 &&
                  y >= 12 &&
                  y <= 33
                );
              })
              .map((f) => ({
                ...f,
                properties: {
                  id: "city-" + f.properties!.name,
                  type: "cities",
                  title: f.properties!.name,
                  country: f.properties!.name,
                  timestamp: null,
                  source: "GeoNames / DCW",
                  source_url: "https://www.geonames.org/",
                  severity: null,
                  confidence: null,
                },
              })),
          );
          setMsg("");
        })
        .catch(() => {
          if (open) setMsg("City inventory unavailable.");
        });
      return () => {
        open = false;
      };
    }
    fetch("/api/layers/infrastructure?start=" + ago(0) + "&end=" + ago(0))
      .then((r) => r.json())
      .then((p) => {
        if (open) {
          setCells((p.features || []).filter((f:Hazard)=>f.properties.asset_type!=="desalination service area"));
          setMsg(p.message || "");
        }
      })
      .catch(() => setMsg("Infrastructure source unavailable."));
    return () => {
      open = false;
    };
  }, [scope]);
  const rows=useMemo(()=>{
    const historical=metric==="historic",cfg=historical?settings.earthquakes:undefined;
    const end=Math.min(Date.now(),Date.parse(cfg?.end||range.end)+864e5-1);
    const start=period&&!cfg?.start&&!cfg?.end?end-period*864e5:Date.parse(cfg?.start||range.start);
    const stop=start+cursor*(end-start);
    const span=Math.max(1,Math.floor(stop/864e5)-Math.floor(start/864e5)+1),minimum=Math.max(4,Number(cfg?.min)||0);
    if(historical&&(!reference||!active.includes("earthquakes")||!quakes||!["ok","empty","partial"].includes(quakes.status)||!quakes.provider.includes("USGS")||/Monthly feed coverage only|USGS record limit/.test(quakes.message)))return [];
    if(!historical&&!active.some(id=>["earthquakes","fires","floods","oil"].includes(id)&&["ok","empty","partial"].includes(feeds[id]?.status)))return [];
    const base=Date.parse("2015-01-01"),periods=Math.floor((Date.parse("2025-01-01")-base)/(span*864e5));
    const events=records.filter(f=>{const ts=Date.parse(f.properties.timestamp||"");return ts>=start&&ts<=stop&&(historical ? f.properties.type==="earthquakes" && f.properties.source==="USGS" && Number(f.properties.severity)>=minimum : ["earthquakes","fires","floods","oil"].includes(f.properties.type));}).map(f=>({f,b:bbox(f)}));
    const history = historical ? reference!.filter(([,x,y])=>matches({type:"Point",coordinates:[x,y]})) : [];
    return cells.filter(cell=>matches(cell.geometry)).map(cell=>{
      const around=buffer(cell,25)!,box=bbox(around),days=new Set<string>();
      for(const {f,b} of events)if(f.properties.timestamp && !(b[2]<box[0]||b[0]>box[2]||b[3]<box[1]||b[1]>box[3]) && booleanIntersects(f,around))days.add(f.properties.timestamp.slice(0,10));
      let value=Math.min(100,Math.round(100*days.size/span));
      if(historical){
        const bins=new Map<number,Set<number>>();
        for(const [time,x,y,mag] of history){
          if(mag<minimum||x<32||x>60||y<12||y>33||x<box[0]||x>box[2]||y<box[1]||y>box[3]||!booleanIntersects({type:"Point",coordinates:[x,y]},around))continue;
          const d=Math.floor((time-base)/864e5),k=Math.floor(d/span);
          if(k>=0&&k<periods){const set=bins.get(k)||new Set<number>();set.add(d);bins.set(k,set);}
        }
        value=days.size ? Math.round(100*(periods-[...bins.values()].filter(v=>v.size>=days.size).length)/periods) : 0;
      }
      return {cell,value};
    }).sort((a,b)=>b.value-a.value);
  },[cells,records,metric,reference,range,settings,cursor,active,quakes,period,feeds,matches]);
  useEffect(() => {
    if (!api || !rows.length) return;
    return api.showRisk({
      type: "FeatureCollection",
      features: rows.map((r) => ({
        ...(r.cell.geometry.type === "Point" ? buffer(r.cell, 25)! : r.cell),
        properties: { score: r.value },
      })),
    });
  }, [api, rows]);
  return (
    <div className="stack">
      <label>
        {t("Exposure locations", "مواقع التعرض")}
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="ports">
            {t("Port and power inventory cells", "خلايا الموانئ ومحطات الطاقة")}
          </option>
          <option value="cities">{t("Cities", "المدن")}</option>
        </select>
      </label>
      <label>{t("Exposure measure","مقياس التعرض")}<select value={metric} onChange={e=>setMetric(e.target.value)}>
        <option value="historic">{t("Seismic activity · historical percentile","النشاط الزلزالي · المئين التاريخي")}</option>
        <option value="observed">{t("All active hazards · observed days (%)","كل المخاطر النشطة · نسبة الأيام المرصودة")}</option></select></label>
      <p>{metric==="historic"?t("Percent of equal-length 2015–2024 intervals with fewer USGS M ≥ 4 observation days within 25 km. A higher threshold in the earthquake settings also applies to the reference.","نسبة الفترات المماثلة بين ٢٠١٥ و٢٠٢٤ التي شهدت أيام رصد أقل لزلازل USGS بقوة ٤ فأكثر ضمن ٢٥ كم. يُطبّق حد القوة المختار على الفترتين."):t("Days with a filtered hazard observation within 25 km, divided by selected days. Repeated observations on a day count once.","نسبة أيام الفترة ذات رصد ضمن ٢٥ كم. يحسب اليوم مرة واحدة مهما تكرر الرصد.")}</p>
      {metric==="historic"&&!active.includes("earthquakes")&&<small>{t("Enable earthquakes to compare with the reference.","فعّلي الزلازل للمقارنة مع المرجع.")}</small>}
      {metric==="historic"&&active.includes("earthquakes")&&!rows.length&&<small>{t("A current USGS window and the historical catalogue are required.","المقارنة محتاجة تغطية USGS للفترة المحددة والفهرس التاريخي.")}</small>}
      <small>{t("These measures describe observed activity. Damage probability requires independent impact records.","المقياسان يصفان النشاط المرصود. تقدير احتمال الضرر يحتاج سجلات أثر مستقلة.")}</small>
      {msg && <p>{msg}</p>}
      <ImpactReference/>
      {metric==="observed"&&!rows.length&&<small>{t("Awaiting usable observations for a selected hazard layer.","في انتظار بيانات صالحة لإحدى طبقات المخاطر المختارة.")}</small>}
      {rows.slice(0, 20).map((r) => (
        <button
          className="listrow"
          key={r.cell.properties.id}
          onClick={() => api && api.focus(r.cell)}
        >
          {r.cell.properties.country} ·{" "}
          {centroid(r.cell)
            .geometry.coordinates.map((v) => v.toFixed(1) + "°")
            .reverse()
            .join(", ")}
          <b>{r.value}</b>
        </button>
      ))}
    </div>
  );
}
