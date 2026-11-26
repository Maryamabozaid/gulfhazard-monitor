import { imageryNote } from "./autoImagery";
import { Fragment, useState, useEffect, useMemo, useRef } from "react";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Check,
  SlidersHorizontal,
  Plus,
  Minus,
  MoveDiagonal,
  PanelRightOpen,
  LocateFixed,
  MapPinned,
  Globe2,
  Layers3,
  Columns2,
  Moon,
  Sun,
  Radio,
  MapPin,
  X,
  Clock3,
  ExternalLink,
  Navigation2,
  Wifi,
  Database,
  Menu,
  ChevronRight,
  Scan,
  Map as MapIcon,
} from "lucide-react";
import { bbox, centroid } from "@turf/turf";
import {
  useStore,
  useText,
  useFeeds,
  layers,
  byId,
  priorities,
  defaults,
  initialSetting,
  cutoff,
  fmt,
  dateText,
  measureText,
  type Hazard,
  type Tool,
  collection,
} from "./model";
import type { Bounds } from "./gis/placeFilter";
import { Icon } from "./icons";
import { MapView, type MapApi } from "./gis/MapView";
import { Feed, statusLabel } from "./Feed";
import { Timeline } from "./Timeline";
import { providerFor } from "./compareImagery";
import {AccountButton} from "./Accounts";
import {ProviderHealth} from "./ProviderHealth";
import { Panels, Settings, toolNames } from "./Panels";
import { usePlaceFilter } from "./gis/placeFilter";
function compact(n: number) {
  return n >= 10000 ? (n / 1000).toFixed(1) + "k" : n.toLocaleString("en-US");
}
export default function App() {
  const s = useStore(),
    t = useText(),
    ar = s.lang === "ar",
    api = useRef<MapApi | null>(null),
    [mapApi, setMapApi] = useState<MapApi | null>(null),
    coordRef = useRef<HTMLSpanElement>(null);
  const [refresh, setRefresh] = useState(0),
    [more, setMore] = useState(false),
    [setting, setSetting] = useState<string | null>(null),
    [legend, setLegend] = useState(false),
    [measure, setMeasure] = useState(""),
    [notice, setNotice] = useState(""),
    [menu, setMenu] = useState(false),
    [health, setHealth] = useState(false);
  const data = useFeeds(s.active, s.range, s.settings, refresh);
  const placeFilter = usePlaceFilter(s.placeIds, s.tool === "places");
  useEffect(()=>{
    const ctrl=new AbortController();
    fetch("/api/catalog",{signal:ctrl.signal}).then(r=>r.ok?r.json():null).then(c=>{
      if(c?.layers)useStore.getState().patch({profile:c.profile,restrictions:Object.fromEntries(c.layers.filter((l:{restricted?:string})=>l.restricted).map((l:{id:string;restricted:string})=>[l.id,l.restricted]))});
    }).catch(()=>{});
    return ()=>ctrl.abort();
  },[]);
  const all = useMemo(
    () =>
      s.active.flatMap((id) =>
        (data[id]?.features || []).filter((f) => {
          const cfg = s.settings[id],
            v = cfg?.min;
          if (!placeFilter.matches(f.geometry)) return false;
          if(id==="fires" && cfg?.excludeIndustrial!==false && f.properties.industrial_reason)return false;
          const end = Math.min(Date.now(), Date.parse(s.range.end) + 864e5 - 1);
          const first =
            s.period && !cfg?.start
              ? end - s.period * 864e5
              : Date.parse(cfg?.start || s.range.start);
          return (
            (!f.properties.timestamp ||
              Date.parse(f.properties.timestamp) >= first) &&
            (!v ||
              (f.properties.severity != null &&
                f.properties.severity >= Number(v)))
          );
        }),
      ),
    [data, s.active, s.settings, s.period, s.range, placeFilter.matches],
  );
  const groups = useMemo(() => {
    const g: Record<string, Hazard[]> = {};
    for (const id of s.active) g[id] = [];
    for (const f of all) {
      const p = f.properties,
        end = cutoff(
          {
            ...s.range,
            ...(s.settings[p.type]?.start
              ? { start: s.settings[p.type].start }
              : {}),
            ...(s.settings[p.type]?.end ? { end: s.settings[p.type].end } : {}),
          },
          s.cursor,
        );
      if (!p.timestamp || Date.parse(p.timestamp) <= end) g[p.type]?.push(f);
    }
    return g;
  }, [all, s.active, s.settings, s.range, s.cursor]);
  const records = useMemo(() => Object.values(groups).flat(), [groups]);
  const compare = s.mode === "compare",
    showFeed = s.feed && !compare;
  useEffect(() => {
    document.documentElement.lang = s.lang;
    document.documentElement.dir = ar ? "rtl" : "ltr";
    document.documentElement.dataset.theme = s.dark ? "dark" : "light";
    localStorage.setItem("gh-lang", s.lang);
    localStorage.setItem("gh-theme", s.dark ? "dark" : "light");
  }, [s.lang, s.dark, ar]);
  useEffect(() => {
    let open = true;
    const test = () =>
      fetch("/api/health")
        .then((r) => {
          if (open) setHealth(r.ok);
        })
        .catch(() => {
          if (open) setHealth(false);
        });
    test();
    const timer = setInterval(test, 60000);
    return () => {
      open = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMore(false);
        setSetting(null);
        setMenu(false);
        s.patch({ tool: null, selected: null, sketch: null });
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 10000);
    return () => clearTimeout(timer);
  }, [notice]);
  const toggle = (tool: Tool) => {
    if (compare && tool === "satellite") {
      s.patch({tool:null,selected:null,sketch:null});
      document.querySelector<HTMLSelectElement>(".compare-side select")?.focus();
      return;
    }
    s.patch({
      tool: s.tool === tool ? null : tool,
      selected: null,
      sketch: null,
    });
    setMore(false);
    setSetting(null);
    setMenu(false);
  };
  const home = () => {
    s.patch({
      tool: null,
      mode: "explore",
      selected: null,
      sketch: null,
      imagery:null, autoImagery:null, autoNote:"",
    });
    setMore(false);
    setSetting(null);
    setMenu(false);
    api.current?.home();
  };
  const onSelect = (f: Hazard) => {
    s.patch({
      selected: f,
      tool: null,
      ...(window.innerWidth < 820 ? { feed: false } : {}),
    });
    if (api.current) api.current.focus(f);
  };
  const riverSites = groups.discharge || [];
  const showRiverSites = () => {
    if (!api.current || !riverSites.length) return;
    setMore(false);
    if (riverSites.length === 1) api.current.focus(riverSites[0]);
    else api.current.fitArea(bbox(collection(riverSites)) as Bounds);
  };
  const openSettings = (id: string) => {
    setMore(false);
    setSetting(setting === id ? null : id);
    s.patch({ tool: null });
  };
  const coord = (x: number, y: number) => {
    if (coordRef.current)
      coordRef.current.textContent =
        Math.abs(y).toFixed(4) +
        "° " +
        (y >= 0 ? "N" : "S") +
        "   " +
        Math.abs(x).toFixed(4) +
        "° " +
        (x >= 0 ? "E" : "W");
  };
  const chip = (id: string) => {
    const l = byId[id],
      on = s.active.includes(id),
      p = data[id];
    return (
      <div
        key={id}
        className={"chip " + (on ? "enabled" : "")}
        style={{ "--haz": l.color } as any}
      >
        <label title={s.restrictions[id]}>
          <input type="checkbox" checked={on} disabled={!!s.restrictions[id]} onChange={() => s.toggle(id)} />
          <span className="check">
            {on && <Check size={10} strokeWidth={3} />}
          </span>
          <Icon name={id} size={18} />
          <b>{ar ? l.ar : l.name}</b>
          <span className="chip-count">
            {on && p && !["error", "setup", "loading"].includes(p.status)
              ? compact(groups[id]?.length || 0)
              : "—"}
          </span>
        </label>
        <button
          title={(ar ? l.ar : l.name) + " " + t("settings", "إعدادات")}
          aria-label={(ar ? l.ar : l.name) + " " + t("settings", "إعدادات")}
          onClick={() => openSettings(id)}
        >
          <ChevronDown size={13} />
        </button>
      </div>
    );
  };
  return (
    <div
      className={"app " + (showFeed ? "with-feed " : "") + (ar ? "arabic" : "")}
    >
      <header>
        <button
          className="brand"
          onClick={home}
          aria-label="GulfHazard Monitor Home"
        >
          <img src="/mark.svg" alt="" />
          <strong>GulfHazard</strong>
          <span>MONITOR</span>
        </button>
        <nav className={menu ? "open" : ""}>
          {[
            ["Home", "الرئيسية", null],
            ["Projects", "المشاريع", "projects"],
            ["About", "حول", "about"],
            ["Contact", "التواصل", "contact"],
          ].map(([en, arab, id]) => (
            <button
              key={en}
              className={
                (
                  id
                    ? s.tool === id
                    : !["projects", "about", "contact"].includes(s.tool || "")
                )
                  ? "current"
                  : ""
              }
              onClick={() => (id ? toggle(id as Tool) : home())}
            >
              {t(en!, arab!)}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <AccountButton/>
          <button
            aria-label={t("Switch theme", "تبديل المظهر")}
            title={t("Switch theme", "تبديل المظهر")}
            onClick={() => s.patch({ dark: !s.dark })}
          >
            {s.dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button
            className="lang"
            aria-label="English / العربية"
            onClick={() => s.patch({ lang: ar ? "en" : "ar" })}
          >
            <Globe2 size={15} />
            {ar ? "EN" : "عربي"}
          </button>
          <button
            className="mobile-menu"
            aria-label={t("Navigation", "التنقل")}
            onClick={() => setMenu(!menu)}
          >
            <Menu size={18} />
          </button>
        </div>
      </header>
      <div className="checkpoints">
        <span className="checkpoint-title">
          <SlidersHorizontal size={16} />
          {t("Checkpoints", "الطبقات")}
        </span>
        <button className="place-filter-trigger" aria-label={t("Filter places","فلترة الأماكن")}
          aria-expanded={s.tool==="places"} data-active={s.placeIds.length>0}
          onClick={()=>toggle("places")}><MapPin size={16}/>{t("Places","الأماكن")}
          {s.placeIds.length>0 && <b>{fmt(s.placeIds.length,ar)}</b>}<ChevronDown size={13}/></button>
        <div className="chips">{priorities.map(chip)}</div>
        <button
          aria-label={t("More layers", "طبقات إضافية")}
          aria-expanded={more}
          className={"more-layers " + (more ? "pressed" : "")}
          onClick={() => {
            setMore(!more);
            setSetting(null);
            s.patch({ tool: null });
          }}
        >
          <Layers3 size={16} />
          {t("More layers", "طبقات إضافية")}
          {s.active.some((id) => !priorities.includes(id)) && (
            <b>{s.active.filter((id) => !priorities.includes(id)).length}</b>
          )}
          <ChevronDown size={14} />
        </button>
        <ProviderHealth compact/>
        <span className={"connection " + (health ? "up" : "")}>
          <i />
          {health
            ? t("Monitor online", "المنصة متصلة")
            : t("Connecting", "جار الاتصال")}
        </span>
      </div>
      <main className={compare ? "comparing" : undefined}>
        <MapView
          placeAreas={placeFilter.areas}
          groups={groups}
          onReady={(m) => {
            api.current = m;
            setMapApi(m);
            const center = m.map.getCenter();
            coord(center.lng, center.lat);
          }}
          onCoord={coord}
          onMeasure={setMeasure}
          onError={setNotice}
        />
        <div className="map-top">
          <div className={"region-label"+((s.imagery||s.autoImagery)&&!compare?" has-image":"")}>
            <span className="region-cross"><LocateFixed size={16} /></span>
            <span title={s.autoImagery?imageryNote(s.autoNote,ar):undefined}>
              {s.autoImagery && !compare && <b>{t("Auto","تلقائي")} · </b>}
              {s.imagery && !compare ? (s.imagery.id.startsWith("S1")?"Sentinel-1 SAR":s.imagery.name) + " · " + s.imagery.date.slice(0,10) + (s.imagery.resolutionLabel?" · "+s.imagery.resolutionLabel:"")
              : s.autoImagery && !compare ? imageryNote(s.autoNote,ar) : t("Arabian Peninsula","شبه الجزيرة العربية")}
            </span>
            {(s.imagery||s.autoImagery)&&!compare&&<button style={{pointerEvents:"auto"}} title={t("Remove imagery","إزالة الصور")} aria-label={t("Remove imagery","إزالة الصور")} onClick={()=>s.patch({imagery:null,autoImagery:null,autoNote:""})}><X size={13}/></button>}
          </div>
          <div className="mode">
            <button
              aria-pressed={!compare}
              className={!compare ? "selected" : ""}
              onClick={() => s.patch({ mode: "explore" })}
            >
              <Globe2 size={15} />
              {t("Explore", "استكشاف")}
            </button>
            <button
              aria-pressed={compare}
              className={compare ? "selected" : ""}
              onClick={() => {
                s.patch({
                  mode: "compare",
                  selected: null,
                  tool: null,
                  sketch: null,
                });
                setMore(false);
                setSetting(null);
              }}
            >
              <Columns2 size={15} />
              {t("Compare", "مقارنة")}
            </button>
          </div>
        </div>
        <div className="toolbar" aria-label={t("Map tools", "أدوات الخريطة")}>
          {(
            [
              "search",
              "layers",
              "basemap",
              "draw",
              "measure",
              "satellite",
              "time",
              "alerts",
              "risk",
              "export",
              "info",
            ] as Tool[]
          ).map((id, i) => (
            <button
              key={id}
              className={
                (s.tool === id ? "active " : "") +
                ([1, 5, 9].includes(i) ? "divider" : "")
              }
              aria-label={t(...toolNames[id!])}
              title={t(...toolNames[id!])}
              onClick={() => toggle(id)}
            >
              <Icon name={id!} size={18} />
            </button>
          ))}
        </div>
        {showFeed && (
          <Feed
            records={records}
            data={data}
            onSelect={onSelect}
            refresh={() => setRefresh((n) => n + 1)}
          />
        )}
        {!s.feed && !compare && (
          <button
            className="feed-reopen glass"
            onClick={() => s.patch({ feed: true })}
          >
            <PanelRightOpen size={16} />
            {t("Hazard feed", "سجل المخاطر")}
          </button>
        )}
        <div className="map-controls glass">
          <button
            aria-label={t("Zoom in", "تكبير")}
            title={t("Zoom in", "تكبير")}
            onClick={() => api.current?.map.zoomIn()}
          >
            <Plus size={18} />
          </button>
          <button
            aria-label={t("Zoom out", "تصغير")}
            title={t("Zoom out", "تصغير")}
            onClick={() => api.current?.map.zoomOut()}
          >
            <Minus size={18} />
          </button>
          <button
            aria-label={t("Fit region", "عرض المنطقة")}
            title={t("Fit region", "عرض المنطقة")}
            onClick={() => api.current?.home()}
          >
            <Scan size={16} />
          </button>
        </div>
            <div className={"legend " + (legend ? "expanded" : "")}>
              <button
                className="legend-button glass"
                onClick={() => setLegend(!legend)}
              >
                <span className="legend-points">
                  <i />
                  <i />
                  <i />
                </span>
                {t("Map legend", "مفتاح الخريطة")}
                {legend ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              </button>
              {legend && (
                <div className="legend-list glass">
                  {s.active.map((id) => (
                    <div key={id}>
                      <Icon
                        name={id}
                        size={16}
                        style={{ color: byId[id].color }}
                      />
                      {ar ? byId[id].ar : byId[id].name}
                      <small>{ar ? byId[id].metricAr : byId[id].metric}</small>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {!compare && <Timeline all={all} />}
        <Panels
          placeFilter={placeFilter}
          api={mapApi}
          records={records}
          data={data}
          measure={measure}
          onMeasure={setMeasure}
          settings={openSettings}
          onSelect={onSelect}
        />
        {more && (
          <>
            <button
              className="dismiss"
              aria-label={t("Close layer menu", "إغلاق قائمة الطبقات")}
              onClick={() => setMore(false)}
            />
            <div className="more-menu glass">
              <div className="panel-head">
                <h2>{t("Additional layers", "طبقات إضافية")}</h2>
                <button
                  className="iconbtn"
                  onClick={() => setMore(false)}
                  aria-label={t("Close", "إغلاق")}
                >
                  <X size={16} />
                </button>
              </div>
              <div className="more-scroll">
                {layers.slice(3).map((l) => (
                  <Fragment key={l.id}>
                  <div className="layerrow">
                    <Icon name={l.id} size={17} style={{ color: l.color }} />
                    <label title={s.restrictions[l.id]}>
                      <input
                        type="checkbox"
                        disabled={!!s.restrictions[l.id]}
                        checked={s.active.includes(l.id)}
                        onChange={() => s.toggle(l.id)}
                      />
                      {ar ? l.ar : l.name}
                    </label>
                    {s.active.includes(l.id) && (
                      <small>
                        {data[l.id] &&
                        !["error", "setup"].includes(data[l.id].status)
                          ? fmt(groups[l.id]?.length || 0)
                          : "—"}
                      </small>
                    )}
                    <button
                      className="iconbtn"
                      aria-label={l.name + " settings"}
                      onClick={() => openSettings(l.id)}
                    >
                      <SlidersHorizontal size={14} />
                    </button>
                  </div>
                  {l.id === "discharge" && s.active.includes(l.id) && !compare && (
                    <div className="river-sites" aria-live="polite">
                      {riverSites.length ? <button onClick={showRiverSites} disabled={!mapApi}>
                        <LocateFixed size={15}/>{t("Show sites on map", "عرض المواقع على الخريطة")} ({fmt(riverSites.length, ar)})
                      </button> : <small>{!data.discharge || ["loading","error","setup","refreshing"].includes(data.discharge.status)
                        ? "Open-Meteo · " + statusLabel(data.discharge?.status || "loading", ar)
                        : data.discharge.features.length
                          ? t("No discharge sites match the current filters.", "لا توجد مواقع تصريف تطابق الفلاتر الحالية.")
                          : t("Open-Meteo returned no discharge values for this period.", "لم يُرجع Open-Meteo قيماً للتصريف في هذه الفترة.")}</small>}
                    </div>
                  )}
                  </Fragment>
                ))}
              </div>
            </div>
          </>
        )}
        {setting && (
          <>
            <button
              className="dismiss"
              aria-label={t("Close settings", "إغلاق الإعدادات")}
              onClick={() => setSetting(null)}
            />
            <div className="settings-wrap glass">
              <Settings id={setting} close={() => setSetting(null)} />
            </div>
          </>
        )}
        {s.selected && (
          <EventDetail
            key={s.selected.properties.id}
            f={s.selected}
            api={mapApi}
          />
        )}
        {notice && (
          <div className="map-toast" role="status">
            {notice}
            <button
              aria-label={t("Dismiss", "إغلاق")}
              onClick={() => setNotice("")}
            >
              <X size={13} />
            </button>
          </div>
        )}
      </main>
      <footer>
        <span className="coords">
          <LocateFixed size={13} />
          <span dir="ltr" ref={coordRef}>
            —
          </span>
        </span>
        <span className="crs">EPSG:3857</span>
        <button onClick={() => toggle("info")}>
          © Natural Earth · GeoNames · Mapzen
          {s.base === "vector" && " · OpenFreeMap · © OSM"}{s.profile==="research"&&" · Esri"}
          {compare
            ? " · " + [...new Set(s.compareProducts.map(providerFor))].join(" · ")
            : s.imagery ? " · " + s.imagery.attribution : ""}
        </button>
        <span className="footer-clock">
          <Clock3 size={12} />
          UTC
        </span>
      </footer>
    </div>
  );
}
function EventDetail({ f, api }: { f: Hazard; api: MapApi | null }) {
  const s = useStore(),
    t = useText(),
    ar = s.lang === "ar",
    p = f.properties,
    l = byId[p.type],
    [notice, setNotice] = useState(""),
    [origin, setOrigin] = useState<string[] | null>(null),
    [history, setHistory] = useState<any[] | null>(null);
  useEffect(() => {
    let alive = true;
    if (p.type === "oil" && !p.likely_source)
      fetch("/api/slick/" + p.id.split(":").pop() + "/origin")
        .then((r) => r.json())
        .then((v) => {
          if (alive) setOrigin(v.classes || []);
        })
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [p]);
  const fields = [
    [t("Source", "المصدر"), p.source],
    [
      p.type === "discharge" ? t("Model period (UTC)", "فترة النموذج (UTC)") : t("Acquired (UTC)", "وقت الرصد (UTC)"),
      p.type === "discharge" && p.valid_from && p.valid_to ? p.valid_from + " – " + p.valid_to : p.timestamp
        ? dateText(p.timestamp, ar, true)
        : t("Inventory / model edition", "إصدار الجرد أو النموذج"),
    ],
    [ar ? l.metricAr : l.metric, p.severity],
    [t("Depth (km)", "العمق (كم)"), p.depth],
    [
      t("Area (km²)", "المساحة (كم²)"),
      p.area_km2 != null ? Number(p.area_km2).toFixed(2) : null,
    ],
    [t("Satellite", "القمر الصناعي"), p.satellite || p.scene?.split("_")[0]],
    [t("Confidence", "الثقة"), p.confidence],
    [
      t("Likely source", "المصدر المحتمل"),
      p.type === "oil"
        ? p.likely_source ||
          origin?.join(", ") ||
          t("Unattributed", "غير منسوب")
        : null,
    ],
    [t("Volcano type", "نوع البركان"), p.volcano_type],
    [t("Last eruption", "آخر ثوران"), p.last_eruption],
    [t("Peak SST (°C)", "أعلى حرارة للسطح (°م)"), p.sst_max_c],
    [t("Edition", "الإصدار"), p.edition || p.year],
    [t("Exceedance probability", "احتمال التجاوز"), p.exceedance],
    [t("Reference site", "الموقع المرجعي"), p.site],
    [t("Units", "الوحدات"), p.units],
    [t("Mean heading (°)", "متوسط الاتجاه (°)"), p.mean_heading],
  ].filter(([, v]) => v != null && v !== "");
  return (
    <div
      className="detail glass"
      role="dialog"
      aria-label={t("Observation details", "تفاصيل المشاهدة")}
    >
      <div className="panel-head">
        <Icon name={p.type} style={{ color: l.color }} />
        <h2>{ar ? l.ar : l.name}</h2>
        <button
          className="iconbtn"
          aria-label={t("Close details", "إغلاق التفاصيل")}
          onClick={() => s.patch({ selected: null })}
        >
          <X size={16} />
        </button>
      </div>
      <div className="stack panel-body">
        <h3>{ar && p.title_ar ? p.title_ar : p.title}</h3>
        <dl>
          {fields.map(([k, v], i) => (
            <div key={i}>
              <dt>{k}</dt>
              <dd>{typeof v === "number" ? fmt(v, ar) : String(v)}</dd>
            </div>
          ))}
        </dl>
        {p.type === "oil" && (
          <small>
            {t(
              "Potential slick. Confidence describes its geometric signature.",
              "بقعة محتملة. تعبّر الثقة عن شكل البقعة المرصود.",
            )}
          </small>
        )}
        {p.type === "fires" && (
          <small>
            {t(
              "A thermal pixel can include industrial heat.",
              "قد يشمل البكسل الحراري حرارة صناعية.",
            )}
          </small>
        )}
        {p.outlook && (
          <>
          <small>{t("Daily model estimate for the nearby 5 km grid cell. Local flash flooding can occur even when modelled discharge is zero.", "تقدير يومي لخلية النموذج القريبة بدقة نحو ٥ كم. قد يحدث سيل محلي حتى لو كانت قيمة التصريف في النموذج صفراً.")}</small>
          {p.site_url && <a className="source-link" href={p.site_url} target="_blank" rel="noreferrer">
            {t("Wadi location · GeoNames", "موقع الوادي · GeoNames")} <ExternalLink size={13}/>
          </a>}
          <details>
            <summary>{t("Modelled discharge", "التصريف النموذجي")}</summary>
            {p.outlook.map((v: any) => (
              <div className="listrow" key={v.day}>
                {v.day}
                <b>{fmt(v.value, ar)} m³/s</b>
              </div>
            ))}
          </details>
          </>
        )}
        {p.type === "volcanoes" && (
          <>
            <button
              onClick={async () => {
                try {
                  const res = await fetch(
                    "/api/volcano/" + p.id.split(":").pop() + "/eruptions",
                  );
                  if (!res.ok) throw Error("Smithsonian GVP unavailable.");
                  setHistory((await res.json()).rows);
                } catch (e) {
                  setNotice(String(e));
                }
              }}
            >
              {t("Eruption history", "تاريخ الثورانات")}
            </button>
            {history && (
              <div>
                {!history.length &&
                  t("No catalogued eruptions.", "لا ثورانات مسجلة.")}
                {history.slice(0, 25).map((r) => (
                  <div className="listrow" key={r.id}>
                    {r.year ?? "—"}{" "}
                    {r.end && r.end !== r.year ? "– " + r.end : ""}
                    <small>
                      {r.activity} {r.vei != null ? "VEI " + r.vei : ""}
                    </small>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {p.scene && (
          <button
            className="primary"
            onClick={async () => {
              setNotice(t("Loading scene…", "جار تحميل المشهد…"));
              try {
                const res = await fetch(
                    "/api/scene?scene=" + encodeURIComponent(p.scene),
                  ),
                  info = await res.json();
                if (!res.ok) throw Error(info.message);
                s.patch({
                  autoImagery:null,autoNote:"", imagery: {
                    id: info.id,
                    tiles: info.tiles,
                    metadataStatus: info.metadataStatus,
                    metadataRetrievedAt: info.metadataRetrievedAt,
                    bounds: info.bounds,
                    name: info.id,
                    attribution: info.source,
                    date: info.time,
                    url: info.url,
                  },
                  selected: null,
                });
                if (api) api.focus(f);
              } catch (e) {
                setNotice(String(e));
              }
            }}
          >
            {t("View SAR scene", "عرض مشهد الرادار")}
          </button>
        )}
        {notice && <small role="status">{notice}</small>}
        <a
          className="source-link"
          href={p.source_url}
          target="_blank"
          rel="noreferrer"
        >
          {t("Original source record", "سجل المصدر الأصلي")}{" "}
          <ExternalLink size={13} />
        </a>
      </div>
    </div>
  );
}
