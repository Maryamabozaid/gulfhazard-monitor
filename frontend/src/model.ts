import { create } from "zustand";
import { useEffect, useState } from "react";
import type { Feature, Geometry, Polygon, FeatureCollection } from "geojson";
import catalog from "../../shared/layers.json";
export const layers = catalog;
export const byId = Object.fromEntries(layers.map((l) => [l.id, l]));
export const priorities = ["earthquakes", "oil", "fires"];
export type RecordProps = {
  id: string;
  type: string;
  title: string;
  timestamp: string | null;
  source: string;
  source_url: string;
  severity: number | null;
  confidence: number | string | null;
  country?: string;
  [key: string]: any;
};
export type Hazard = Feature<Geometry, RecordProps>;
export type Payload = {
  type: "FeatureCollection";
  features: Hazard[];
  status: string;
  message: string;
  lastSuccess: string | null;
  provider: string;
  coverage?: string[];
};
export type AOI = Feature<Polygon>;
export type DateRange = { start: string; end: string };
export type Setting = {
  excludeIndustrial?:boolean;
  opacity: number;
  min: string;
  start: string;
  end: string;
};
export const initialSetting: Setting = {
  opacity: 0.9,
  min: "",
  start: "",
  end: "",
};
export const day = (d: number | string | Date) =>
  new Date(d).toISOString().slice(0, 10);
export const ago = (n: number) => day(Date.now() - n * 864e5);
export const windowDays = (days: number) => ({ start: ago(days), end: ago(0) });
export type Tool =
  | "search"
  | "places"
  | "layers"
  | "basemap"
  | "draw"
  | "measure"
  | "satellite"
  | "time"
  | "alerts"
  | "export"
  | "info"
  | "stats"
  | "projects"
  | "about"
  | "contact"
  | "risk"
  | null;
export type Mode = "explore" | "compare";
export type ImageLayer = {
  id: string;
  tiles: string[];
  name: string;
  attribution: string;
  date: string;
  product?: string; requestedDate?: string; resolutionLabel?: string; nativeZoom?: number; cloudCover?: number | null;
  metadataStatus?: string;
  metadataRetrievedAt?: string;
  bounds?: number[];
  url?: string;
  overlay?: string; items?: {date:string;url:string}[]; threshold?:number; valid?:number; water?:number; decreased?:number; increased?:number;
};
type Store = {
  active: string[];
  placeIds: string[];
  restrictions: Record<string,string>;
  profile: string;
  settings: Record<string, Setting>;
  range: DateRange;
  period: number;
  tool: Tool;
  lang: "en" | "ar";
  dark: boolean;
  base: string;
  mode: Mode;
  feed: boolean;
  cursor: number;
  aoi: AOI | null;
  sketch: string | null;
  selected: Hazard | null;
  imagery: ImageLayer | null;
  autoImagery: {date:string; lookback:number} | null;
  autoNote: string;
  compareDates: [string, string];
  compareProducts: [string, string];
  compareHazards: boolean;
  patch: (s: Partial<Store>) => void;
  toggle: (id: string) => void;
  setting: (id: string, s: Partial<Setting>) => void;
  setDays: (d: number) => void;
};
export const useStore = create<Store>((set) => ({
  active: [...priorities],
  placeIds: [],
  restrictions:{},profile:"",
  settings: {},
  range: windowDays(7),
  period: 7,
  tool: null,
  lang: localStorage.getItem("gh-lang") === "ar" ? "ar" : "en",
  dark: localStorage.getItem("gh-theme") === "dark",
  base: "light",
  mode: "explore",
  feed: window.innerWidth > 820,
  cursor: 1,
  aoi: null,
  sketch: null,
  selected: null,
  imagery: null,
  autoImagery:null, autoNote:"",
  compareDates: [ago(7), ago(1)],
  compareProducts: ["daily","daily"],
  compareHazards: true,
  patch: (patch) => set(s=>patch.active||patch.restrictions ? {...patch,active:(patch.active||s.active).filter(id=>!(patch.restrictions||s.restrictions)[id])}:patch),
  toggle: (id) =>
    set((s) => ({
      active: s.restrictions[id]?s.active:s.active.includes(id)
        ? s.active.filter((x) => x !== id)
        : [...s.active, id],
      selected: null,
    })),
  setting: (id, v) =>
    set((s) => ({
      settings: {
        ...s.settings,
        [id]: { ...initialSetting, ...s.settings[id], ...v },
      },
    })),
  setDays: (d) =>
    set({ period: d, range: windowDays(d), cursor: 1, selected: null }),
}));
export function useText() {
  const lang = useStore((s) => s.lang);
  return (en: string, ar: string) => (lang === "ar" ? ar : en);
}
export const loc = (ar: boolean) => (ar ? "ar-SA-u-ca-gregory" : "en-GB");
export const dateText = (v: string | null, ar = false, full = false) =>
  v
    ? new Intl.DateTimeFormat(loc(ar), {
        timeZone: "UTC",
        day: "2-digit",
        month: "short",
        ...(full
          ? { year: "numeric", hour: "2-digit", minute: "2-digit" }
          : {}),
      }).format(new Date(v))
    : "—";
export const fmt = (n: number, ar = false) =>
  new Intl.NumberFormat(loc(ar), { maximumFractionDigits: 2 }).format(n);
export const defaults = (id: string): Payload => ({
  type: "FeatureCollection",
  features: [],
  status: "loading",
  message: "",
  lastSuccess: null,
  provider: byId[id].source,
});
export const collection = (features: Hazard[]): FeatureCollection => ({
  type: "FeatureCollection",
  features: [...features],
});
export function useFeeds(
  active: string[],
  range: DateRange,
  settings: Record<string, Setting>,
  refresh: number,
) {
  const [data, setData] = useState<Record<string, Payload>>({});
  const q = JSON.stringify(
    active.map((id) => [
      id,
      settings[id]?.start || range.start,
      settings[id]?.end || range.end,
    ]),
  );
  useEffect(() => {
    const controller = new AbortController(),
      timers: number[] = [];
    let closed = false;
    const selections = JSON.parse(q) as [string, string, string][];
    setData({});
    for (const [id, start, end] of selections) {
      const get = async (background = true) => {
        let next = byId[id].ttl * 1000;
        try {
          const res = await fetch(
            "/api/layers/" +
              id +
              "?" +
              new URLSearchParams({
                start,
                end,
                background: background ? "1" : "0",
              }),
            { signal: controller.signal },
          );
          if (!res.ok) throw Error("HTTP " + res.status);
          const p: Payload = await res.json();
          if (closed) return;
          setData((old) => ({ ...old, [id]: p }));
          if (p.status === "refreshing") next = 2500;
          else if (["error", "stale"].includes(p.status)) next = 60000;
          timers.push(
            window.setTimeout(() => get(p.status !== "refreshing"), next),
          );
        } catch (e) {
          if (closed) return;
          setData((old) => ({
            ...old,
            [id]: {
              ...(old[id] || defaults(id)),
              status: old[id]?.features.length ? "stale" : "error",
              message: "API connection failed. " + String(e),
            },
          }));
          timers.push(window.setTimeout(() => get(false), 60000));
        }
      };
      void get();
    }
    return () => {
      closed = true;
      controller.abort();
      timers.forEach(clearTimeout);
    };
  }, [q, refresh]);
  return data;
}
export function filterByTime(f: Hazard, start: number, end: number) {
  const ts = f.properties.timestamp;
  return !ts || (Date.parse(ts) >= start && Date.parse(ts) <= end);
}
export function cutoff(range: DateRange, cursor: number) {
  const b = Math.min(Date.now(), Date.parse(range.end) + 864e5 - 1),
    s = useStore.getState();
  const a =
    s.period && range.start === s.range.start && range.end === s.range.end
      ? b - s.period * 864e5
      : Date.parse(range.start);
  return a + cursor * (b - a);
}
export const measureText = (f: Hazard) => {
  const p = f.properties;
  if (p.severity == null) return "—";
  const n = Number(p.severity);
  switch (p.type) {
    case "earthquakes":
      return "M " + n.toFixed(1);
    case "oil":
      return p.area_km2 != null
        ? Number(p.area_km2).toFixed(1) + " km²"
        : n.toFixed(2);
    case "fires":
      return n.toFixed(1) + " MW";
    case "marine":
      return "BAA " + n;
    default:
      return fmt(n);
  }
};
