import { setTimeout as sleep } from "node:timers/promises";

export class SetupError extends Error {}
export function params(base, values) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(values))
    if (value !== undefined) url.searchParams.set(key, String(value));
  return url;
}

// Never include upstream URLs in error messages. Some providers put credentials in paths.
export async function request(url, options = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(22000),
      });
    } catch {
      if (attempt === 0) continue;
      throw Error("Provider connection timed out or failed.");
    }
    if (res.ok) return res;
    if (attempt === 0 && [429, 502, 503, 504].includes(res.status)) {
      const pause = Number(res.headers.get("retry-after") || 1);
      await res.body?.cancel();
      if (Number.isFinite(pause) && pause <= 4) {
        await sleep(Math.max(1, pause) * 1000);
        continue;
      }
    }
    throw Error("Provider returned HTTP " + res.status + ".");
  }
}
export async function json(url, options) {
  const res = await request(url, options);
  if (res.status === 204) return { type: "FeatureCollection", features: [] };
  return res.json();
}
export const day = (d) => new Date(d).toISOString().slice(0, 10);
export const addDays = (date, n) => day(Date.parse(date) + n * 86400000);
export const utc = (value) => {
  if (value == null || value === "") return null;
  const parsed = new Date(
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(value) &&
    !/(Z|[+-]\d\d:\d\d)$/.test(value)
      ? value + "Z"
      : value,
  );
  return Number.isFinite(+parsed) ? parsed.toISOString() : null;
};
export function safeLink(value, fallback) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : fallback;
  } catch {
    return fallback;
  }
}
export const BOX = [32, 12, 60, 33];
export const inside = ([x, y]) =>
  x >= BOX[0] && x <= BOX[2] && y >= BOX[1] && y <= BOX[3];
export const numeric = (v) =>
  v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
export function feature(type, id, geometry, data) {
  const key = type + ":" + id;
  return {
    type: "Feature",
    id: key,
    geometry,
    properties: {
      severity: null,
      confidence: null,
      timestamp: null,
      ...data,
      id: key,
      type,
    },
  };
}
export const point = (x, y) => ({ type: "Point", coordinates: [+x, +y] });
