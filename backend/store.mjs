import { db, first } from "./database.mjs";
import { profile, restriction } from "./licensing.mjs";
export { db };
import { gzipSync, gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { bbox } from "@turf/bbox";
import { earthquakes, oil, fires, quake, slick, fire } from "./priority.mjs";
import { discharge, stations } from "./outlooks.mjs";
import {
  volcanoes,
  floods,
  air,
  marine,
  flights,
  dataset,
} from "./context.mjs";
import { day, SetupError } from "./net.mjs";
import {portActivity} from "./regional-providers.mjs";
import {industrialReason} from "./thermal.mjs";

export const layers = JSON.parse(
  readFileSync(new URL("../shared/layers.json", import.meta.url)),
);
const cacheLimit = Math.min(8192, Math.max(128, Number(process.env.CACHE_RESPONSES) || 1024));
const countries = JSON.parse(
  readFileSync(new URL("../gis/public/cartography/land.geojson", import.meta.url)),
).features.map((f) => [bbox(f), f]);
const locateCache = new Map();
export function countryOf(f) {
  const b = bbox(f),
    x = (b[0] + b[2]) / 2,
    y = (b[1] + b[3]) / 2,
    key = x.toFixed(3) + "," + y.toFixed(3);
  if (locateCache.has(key)) return locateCache.get(key);
  const result =
    countries.find(
      ([box, poly]) =>
        x >= box[0] &&
        x <= box[2] &&
        y >= box[1] &&
        y <= box[3] &&
        booleanPointInPolygon([x, y], poly),
    )?.[1].properties.name || "Offshore";
  if (locateCache.size > 150000) locateCache.clear();
  locateCache.set(key, result);
  return result;
}
const fetchers = {
  portcalls:portActivity,
  earthquakes,
  oil,
  fires,
  volcanoes,
  floods,
  air,
  marine,
  flights,
  discharge,
  stations,
};
const seeds = new Map(),
  pending = new Map(),
  failures = new Map();
const names = {
  earthquakes: ["usgs-regional-30d", quake],
  oil: ["cerulean-regional-7d", slick],
  fires: ["firms-noaa20-regional-7d", (f) => fire(f.properties)],
};
export const inWindow = (f, start, end) =>
  !f.properties.timestamp ||
  (f.properties.timestamp.slice(0, 10) >= start &&
    f.properties.timestamp.slice(0, 10) <= end);
function prepare(features, start, end) {
  const map = new Map();
  for (const f of features)
    if (f.geometry && inWindow(f, start, end)) {
      if (!f.properties.country) f.properties.country = countryOf(f);
      map.set(f.id, f);
    }
  return [...map.values()].sort((a, b) =>
    (b.properties.timestamp || "").localeCompare(a.properties.timestamp || ""),
  );
}
function seed(id, start, end) {
  if (!names[id]) return null;
  if (!seeds.has(id)) {
    try {
      const [name, convert] = names[id],
        raw = JSON.parse(
          gunzipSync(
            readFileSync(
              new URL("../datasets/" + name + ".json.gz", import.meta.url),
            ),
          ),
        );
      seeds.set(id, {
        features: prepare(
          raw.features.map((f) => convert(f)),
          day(raw.metadata.requestedWindowStart),
          day(raw.metadata.requestedWindowEnd),
        ),
        ...raw.metadata,
      });
    } catch {
      seeds.set(id, null);
    }
  }
  const s = seeds.get(id);
  if (
    !s ||
    end < day(s.requestedWindowStart) ||
    start > day(s.requestedWindowEnd)
  )
    return null;
  return {
    type: "FeatureCollection",
    features: s.features.filter((f) => inWindow(f, start, end)),
    provider: s.provider,
    lastSuccess: s.retrievedAt,
    coverage: [s.requestedWindowStart, s.requestedWindowEnd],
    status: "stale",
    message: "Showing a dated provider capture.",
  };
}
export function validateWindow(start, end) {
  const valid = (s) =>
    typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    day(s) === s;
  return (
    valid(start) &&
    valid(end) &&
    start <= end &&
    end <= day(Date.now()) &&
    Date.parse(end) - Date.parse(start) <= 365 * 86400000
  );
}
export async function getLayer(id, start, end, background = false) {
  const def = layers.find((l) => l.id === id);
  if (!def || !validateWindow(start, end))
    throw Error("Invalid layer or date window.");
  if (restriction(id)) return {type:"FeatureCollection",features:[],provider:def.source,lastSuccess:null,status:"setup",coverage:[start,end],message:"Unavailable in the commercial distribution: "+restriction(id)};
  const key = [profile, id, start, end].join("|");
  const row = await first("SELECT at,data FROM responses WHERE key=$1",[key]);
  const prior = row ? JSON.parse(gunzipSync(row.data)) : null;
  if(prior && id==="fires")for(const f of prior.features)if(f.properties.industrial_reason===undefined)f.properties.industrial_reason=industrialReason(...f.geometry.coordinates);
  if (prior && Date.now() - Date.parse(row.at) < def.ttl * 1000) return prior;
  const fallback = prior || seed(id, start, end);
  const previous = (await first("SELECT MAX(at) AS at FROM responses WHERE layer=$1 AND key LIKE $2",[id,profile+"|%"])).at;
  const base = {
    type: "FeatureCollection",
    features: [],
    provider: def.source,
    lastSuccess: previous,
    status: "error",
    coverage: [start, end],
    message: "",
  };
  const failed = failures.get(key);
  if (failed && Date.now() - failed.time < 60000) return failed.result;
  if (!pending.has(key)) {
    const job = (async () => {
      try {
        const result = await (fetchers[id]
          ? fetchers[id](start, end)
          : dataset(id));
        const features = prepare(result.features, start, end),
          now = new Date().toISOString();
        const value = {
          ...base,
          features,
          provider: result.provider || def.source,
          lastSuccess: now,
          coverage: result.coverage || [start, end],
          status: result.partial ? "partial" : features.length ? "ok" : "empty",
          message:
            result.partial ||
            (features.length
              ? ""
              : "No observations in the requested region and dates."),
        };
        await db.transaction(async c=>{
          await c.query("INSERT INTO responses VALUES($1,$2,$3,$4) ON CONFLICT(key) DO UPDATE SET at=excluded.at,data=excluded.data WHERE responses.at<=excluded.at",[key,id,now,gzipSync(JSON.stringify(value),{level:3})]);
          await c.query("DELETE FROM responses WHERE key IN (SELECT key FROM responses ORDER BY at DESC,key OFFSET $1)",[cacheLimit]);
          await c.query("INSERT INTO providers(profile,layer,success,down) VALUES($1,$2,$3,false) ON CONFLICT(profile,layer) DO UPDATE SET success=excluded.success,down=false,problem=NULL",[profile,id,now]);
        });
        return value;
      } catch (e) {
        const reason =
          e instanceof SetupError ||
          /^(Provider |Historical FIRMS|FIRMS did not|Dataset features)/.test(
            e.message,
          )
            ? e.message
            : "Provider could not supply a valid response.";
        await db.query("INSERT INTO providers(profile,layer,failure,problem,down) VALUES($1,$2,$3,$4,true) ON CONFLICT(profile,layer) DO UPDATE SET failure=excluded.failure,problem=excluded.problem,down=true",[profile,id,new Date().toISOString(),reason]);
        const result = {
          ...(fallback || base),
          status: fallback
            ? "stale"
            : e instanceof SetupError
              ? "setup"
              : "error",
          message:
            reason +
            (fallback ? " Showing the available cached coverage." : ""),
        };
        if (failures.size >= 256) failures.clear();
        failures.set(key, { time: Date.now(), result });
        return result;
      } finally {
        pending.delete(key);
      }
    })();
    pending.set(key, job);
  }
  if (background && fallback)
    return {
      ...fallback,
      status: "refreshing",
      message: "Refreshing the dated provider capture.",
    };
  return pending.get(key);
}
