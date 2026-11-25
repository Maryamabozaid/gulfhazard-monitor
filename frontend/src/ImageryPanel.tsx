import { useEffect, useRef, useState } from "react";
import { useStore, useText, ago, type ImageLayer } from "./model";
import type { MapApi } from "./gis/mapApi";
import { products, raster } from "./imagery";
import { imageryNote } from "./autoImagery";

export function ImageryPanel({ api }: { api: MapApi | null }) {
  const s = useStore(),
    t = useText(),
    ar = s.lang === "ar";
  const [product, setProduct] = useState(
    s.autoImagery
      ? "auto"
      : s.imagery?.product ||
          (products.some((p) => p[0] === s.imagery?.id)
            ? s.imagery!.id
            : "true"),
  );
  const [date, setDate] = useState(
    s.autoImagery?.date ||
      s.imagery?.requestedDate ||
      s.imagery?.date.slice(0, 10) ||
      ago(1),
  );
  const [lookback, setWindow] = useState(s.autoImagery?.lookback ?? 30);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  function reset() {
    request.current?.abort();
    setBusy(false);
    setMessage("");
  }
  const scene = product === "landsat" || product === "optical",
    auto = product === "auto";
  async function load() {
    if (!api || !date) return;
    reset();
    if (auto) {
      s.patch({
        autoImagery: { date, lookback },
        autoNote: "searching",
        imagery: null,
      });
      return;
    }
    s.patch({ autoImagery: null, autoNote: "" });
    const ctrl = new AbortController();
    request.current = ctrl;
    setBusy(true);
    try {
      let image: ImageLayer;
      if (scene) {
        const focus = api.map.getCenter();
        const qs = new URLSearchParams({
          date,
          lon: String(focus.lng),
          lat: String(focus.lat),
          lookback: String(lookback),
          collection:
            product === "optical" ? "sentinel-2-l2a" : "landsat-c2-l2",
        });
        const res = await fetch("/api/scene?" + qs, { signal: ctrl.signal });
        const info = await res.json();
        if (!res.ok)
          throw Error(imageryNote(info.code || "provider", ar) || info.message);
        image = {
          id: info.id,
          product,
          name: info.platform.toUpperCase(),
          date: info.time,
          requestedDate: date,
          nativeZoom: info.nativeZoom,
          resolutionLabel: info.resolution + " m",
          attribution: info.source,
          cloudCover: info.cloudCover,
          tiles: info.tiles,
          bounds: info.bounds,
          url: info.url,
          metadataStatus: info.metadataStatus,
          metadataRetrievedAt: info.metadataRetrievedAt,
        };
      } else {
        if (["s1", "s2", "ch4", "co"].includes(product)) {
          const r = await fetch("/api/catalog", { signal: ctrl.signal });
          if (!(await r.json()).copernicus)
            throw Error(
              t(
                "Configure Copernicus credentials on the server.",
                "أضيفي بيانات كوبرنيكوس على الخادم.",
              ),
            );
        }
        image = { ...raster(product, date), product };
        if (["true", "viirs", "noaa20"].includes(product)) {
          const params = new URLSearchParams({ product, date });
          const r = await fetch("/api/imagery/dates?" + params, {
            signal: ctrl.signal,
          });
          const coverage = await r.json();
          if (!r.ok)
            throw Error(
              t(
                "NASA GIBS publication dates are unavailable.",
                "تعذّر التحقق من تواريخ النشر لدى ناسا.",
              ),
            );
          if (!coverage.available)
            throw Error(
              t(
                "NASA GIBS has no published image for this day.",
                "ناسا لم تنشر صورة من هذا القمر لهذا اليوم.",
              ) +
                (coverage.latest
                  ? t(
                      " Latest published day on or before the target: ",
                      " آخر يوم منشور حتى التاريخ المطلوب: ",
                    ) + coverage.latest
                  : ""),
            );
          image.metadataRetrievedAt = coverage.metadataRetrievedAt;
          image.metadataStatus = coverage.metadataStatus;
        }
      }
      if (!ctrl.signal.aborted) s.patch({ imagery: image });
    } catch (e) {
      if (!ctrl.signal.aborted)
        setMessage(
          e instanceof Error ? e.message : imageryNote("provider", ar),
        );
    } finally {
      if (!ctrl.signal.aborted) setBusy(false);
    }
  }
  const image = s.imagery;
  return (
    <div className="stack">
      <label>
        {t("Satellite product", "منتج القمر الصناعي")}
        <select
          aria-label={t("Satellite product", "منتج القمر الصناعي")}
          value={product}
          onChange={(e) => {
            reset();
            setProduct(e.target.value);
          }}
        >
          {products.map((p) => (
            <option key={p[0]} value={p[0]}>
              {p[ar ? 2 : 1]}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("Target date (UTC)", "التاريخ المطلوب (UTC)")}
        <input
          type="date"
          value={date}
          max={ago(0)}
          onChange={(e) => {
            reset();
            setDate(e.target.value);
          }}
        />
      </label>
      {(auto || scene) && (
        <label>
          {t("Scene search window", "فترة البحث عن لقطة")}
          <select
            aria-label={t("Scene search window", "فترة البحث عن لقطة")}
            value={lookback}
            onChange={(e) => {
              reset();
              setWindow(+e.target.value);
            }}
          >
            <option value={0}>
              {t("Selected day only", "اليوم المحدد فقط")}
            </option>
            {[7, 30].map((n) => (
              <option key={n} value={n}>
                {t(
                  "Up to " + n + " days earlier",
                  "حتى " + n + " يوم قبل التاريخ",
                )}
              </option>
            ))}
          </select>
        </label>
      )}
      {auto && (
        <small>
          {t(
            "Zoom or pan to select imagery for the centre of the map. Daily VIIRS for a regional view, Landsat or Sentinel-2 for local detail.",
            "كبّري أو حرّكي الخريطة لاختيار لقطة تغطي مركزها. فيرس للنظرة الإقليمية، ولاندسات أو سنتينل-2 لتفاصيل المدن.",
          )}
        </small>
      )}
      <button
        className="primary"
        disabled={busy || !api || !date || date > ago(0)}
        onClick={load}
      >
        {busy
          ? t("Searching…", "جارٍ البحث…")
          : t("Load imagery", "تحميل الصور")}
      </button>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {s.autoImagery && <p role="status">{imageryNote(s.autoNote, ar)}</p>}
      {image && (
        <div className="stack imagery-info">
          <b>
            {t("On the map", "المعروض على الخريطة")} · {image.name}
          </b>
          <small>
            {t("Acquisition", "تاريخ التصوير")} · {image.date.slice(0, 10)} UTC
            {image.resolutionLabel ? " · " + image.resolutionLabel : ""}
          </small>
          {image.requestedDate &&
            image.requestedDate !== image.date.slice(0, 10) && (
              <small>
                {t("Requested date", "التاريخ المطلوب")} · {image.requestedDate}
              </small>
            )}
          {image.cloudCover != null && (
            <small>
              {t("Scene cloud cover", "تغطية السحب في المشهد")} ·{" "}
              {Math.round(image.cloudCover)}%
            </small>
          )}
          <small>
            {image.attribution}
            {image.metadataStatus ? " · " + image.metadataStatus : ""}
            {image.metadataRetrievedAt
              ? " · " +
                image.metadataRetrievedAt.slice(0, 16).replace("T", " ") +
                " UTC"
              : ""}
          </small>
          {image.id === "true" && (
            <small>
              {t(
                "Between MODIS passes the basemap shows through.",
                "بين مسارات تصوير موديس بتظهر خريطة الأساس في فراغات التغطية.",
              )}
            </small>
          )}
          {image.url && (
            <a href={image.url} target="_blank" rel="noreferrer">
              {t("Original scene record", "سجل اللقطة من المصدر")}
            </a>
          )}
        </div>
      )}
      {(s.autoImagery || image) && (
        <button
          onClick={() => {
            reset();
            s.patch({ imagery: null, autoImagery: null, autoNote: "" });
          }}
        >
          {t("Remove image", "إزالة الصورة")}
        </button>
      )}
    </div>
  );
}
