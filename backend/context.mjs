import {clientToken} from "./oauth.mjs";
import {profile} from "./licensing.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { bbox as extent } from "@turf/bbox";
import {
  BOX,
  params,
  json,
  request,
  utc,
  day,
  addDays,
  inside,
  numeric,
  feature,
  point,
  safeLink,
  SetupError,
} from "./net.mjs";
const cities = JSON.parse(
  await readFile(
    new URL("../gis/public/cartography/labels.geojson", import.meta.url),
  ),
).features.filter(
  (f) => f.properties.kind === "city" && inside(f.geometry.coordinates),
);
export const places = cities.filter((f) => f.properties.rank <= 2).slice(0, 20);

export async function volcanoes() {
  const url = params(
    "https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows",
    {
      service: "WFS",
      version: "1.0.0",
      request: "GetFeature",
      typeName: "GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes",
      outputFormat: "application/json",
      bbox: BOX.join(",") + ",EPSG:4326",
    },
  );
  const data = await json(url);
  return {
    features: data.features.map((f) => {
      const p = f.properties;
      return feature("volcanoes", p.Volcano_Number, f.geometry, {
        title: p.Volcano_Name,
        source: "Smithsonian GVP",
        source_url: "https://volcano.si.edu/volcano.cfm?vn=" + p.Volcano_Number,
        severity: numeric(p.Elevation),
        volcano_type: p.Primary_Volcano_Type,
        last_eruption: p.Last_Eruption_Year,
        country: p.Country,
      });
    }),
  };
}
export async function floods(start, end) {
  const list = [];
  let capped = true;
  for (let page = 1; page <= 15; page++) {
    const data = await json(
      params("https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH", {
        eventlist: "FL",
        fromdate: start,
        todate: end,
        pagesize: 100,
        pagenumber: page,
      }),
    );
    for (const f of data.features) {
      const p = f.properties;
      if (
        !f.geometry ||
        f.geometry.type !== "Point" ||
        !inside(f.geometry.coordinates)
      )
        continue;
      list.push(
        feature("floods", p.eventid + "-" + p.episodeid, f.geometry, {
          title: p.name || p.eventname || "Flood alert",
          timestamp: utc(p.fromdate),
          end: utc(p.todate),
          severity: { Green: 1, Orange: 2, Red: 3 }[p.alertlevel] ?? null,
          country: p.country,
          source: "GDACS",
          source_url: safeLink(
            p.url?.report,
            "https://www.gdacs.org/report.aspx?eventtype=FL&eventid=" +
              p.eventid,
          ),
        }),
      );
    }
    if (data.features.length < 100) {
      capped = false;
      break;
    }
  }
  return {
    features: list,
    partial: capped ? "GDACS pagination limit reached." : "",
  };
}
export async function air(start, end) {
  const first = start < addDays(end, -6) ? addDays(end, -6) : start;
  const u = params("https://air-quality-api.open-meteo.com/v1/air-quality", {
    latitude: places.map((f) => f.geometry.coordinates[1]).join(","),
    longitude: places.map((f) => f.geometry.coordinates[0]).join(","),
    hourly: "dust,pm10,pm2_5",
    timezone: "GMT",
    start_date: first,
    end_date: end,
  });
  const raw = await json(u);
  const features = [];
  for (const [index, data] of (Array.isArray(raw) ? raw : [raw]).entries()) {
    const p = places[index],
      h = data.hourly;
    // One latest available model sample per location / UTC day.
    const samples = new Map();
    for (let i = 0; i < h.time.length; i++)
      if (h.dust[i] != null && Date.parse(h.time[i] + "Z") <= Date.now())
        samples.set(h.time[i].slice(0, 10), i);
    for (const i of samples.values())
      features.push(
        feature("air", index + "-" + h.time[i], p.geometry, {
          title: p.properties.name,
          timestamp: utc(h.time[i] + ":00Z"),
          severity: numeric(h.dust[i]),
          pm10: h.pm10[i],
          pm2_5: h.pm2_5[i],
          source: "CAMS / Open-Meteo",
          source_url: "https://open-meteo.com/en/docs/air-quality-api",
        }),
      );
  }
  return {
    features,
    partial:
      first !== start
        ? "Latest seven requested days, daily city model samples."
        : "",
  };
}
export async function marine(start, end) {
  const results = await Promise.allSettled(
    ["jazan", "madinah_makkah", "gulf_of_aqaba", "bahrain"].map(
      async (station) => {
        const url =
          "https://www.coralreefwatch.noaa.gov/product/vs/data/" +
          station +
          ".txt";
        const raw = await (await request(url)).text();
        const field = (k) =>
          raw.match(new RegExp(k + ":\\s*([^\\r\\n]+)", "i"))?.[1]?.trim();
        const x = numeric(field("Polygon Middle Longitude")),
          y = numeric(field("Polygon Middle Latitude"));
        if (x === null || y === null)
          throw Error("Unrecognized NOAA station coordinates.");
        const out = [];
        for (const line of raw.split(/\r?\n/)) {
          const v = line.trim().split(/\s+/);
          if (v.length < 10 || !/^\d{4}$/.test(v[0])) continue;
          const d =
            v[0] + "-" + v[1].padStart(2, "0") + "-" + v[2].padStart(2, "0");
          if (d < start || d > end || +v[9] < 0) continue;
          out.push(
            feature("marine", station + "-" + d, point(x, y), {
              title: field("Name") || station,
              timestamp: utc(d),
              severity: numeric(v[9]),
              sst_max_c: numeric(v[4]),
              degree_heating_weeks: numeric(v[8]),
              source: "NOAA Coral Reef Watch",
              source_url: url,
            }),
          );
        }
        return out;
      },
    ),
  );
  if (results.every((r) => r.status === "rejected"))
    throw Error("NOAA regional station data unavailable.");
  return {
    features: results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])),
    partial: results.some((r) => r.status === "rejected")
      ? "Some NOAA stations were unavailable."
      : "",
  };
}
export async function flights(start, end) {
  if (end !== day(Date.now()))
    throw new SetupError("OpenSky supplies current regional activity only.");
  const u = params("https://opensky-network.org/api/states/all", {
    lamin: 12,
    lomin: 32,
    lamax: 33,
    lomax: 60,
  });
  const token = process.env.OPENSKY_CLIENT_ID ? await clientToken("OPENSKY","https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token") : process.env.OPENSKY_ACCESS_TOKEN;
  const data = await json(u, {
    headers: token ? { Authorization: "Bearer " + token } : {},
  });
  if (!Number.isFinite(data.time)) throw Error("Invalid OpenSky response.");
  const cells = new Map();
  for (const s of data.states || []) {
    if (s[5] == null || s[6] == null || !inside([s[5], s[6]])) continue;
    const x = Math.floor(s[5]) + 0.5,
      y = Math.floor(s[6]) + 0.5,
      k = x + "," + y;
    const a = cells.get(k) || { count: 0, east: 0, north: 0, headings: 0 };
    a.count++;
    if (Number.isFinite(s[10])) {
      const r = (s[10] * Math.PI) / 180;
      a.east += Math.sin(r);
      a.north += Math.cos(r);
      a.headings++;
    }
    cells.set(k, a);
  }
  return {
    features: [...cells].map(([k, a]) =>
      feature("flights", k, point(...k.split(",").map(Number)), {
        title: "Regional aircraft activity",
        timestamp: utc(data.time * 1000),
        severity: a.count,
        mean_heading:
          a.headings && Math.hypot(a.east, a.north) / a.headings > 0.25
            ? ((Math.atan2(a.east, a.north) * 180) / Math.PI + 360) % 360
            : null,
        source: "OpenSky Network",
        source_url: "https://opensky-network.org/",
      }),
    ),
  };
}
const adapters = {
  seismic: ["GEM_GEOJSON", "PGA zones with severity in g"],
  flaring: ["FLARING_GEOJSON", "documented flare observations"],
  vessels: ["AIS_DENSITY_GEOJSON", "gridded traffic density"],
  infrastructure: ["INFRASTRUCTURE_GEOJSON", "regional facility counts"],
  subsidence: ["INSAR_GEOJSON", "validated displacement observations"],
};
export async function dataset(id) {
  const [key, needed] = adapters[id];
  const file = process.env[key];
  const bundled = {
    seismic: "seismic.geojson",
    flaring: "flaring.geojson",
    infrastructure: "infrastructure.geojson",
    subsidence: "subsidence.geojson",
    vessels: "vessels.geojson",
  }[id];
  let data;
  if (file)
    data = file.startsWith("https://")
      ? await json(file)
      : JSON.parse(await readFile(path.resolve(file), "utf8"));
  else if (bundled) {
    try {
      data = JSON.parse(
        await readFile(
          new URL("../datasets/" + bundled, import.meta.url),
          "utf8",
        ),
      );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  if (!data) throw new SetupError("Configure " + key + " with " + needed + ".");
  if (id==="infrastructure"&&!file){
    const files=profile==="commercial"?["power.geojson"]:["power.geojson","desalination.geojson"];
    for(const name of files){const part=JSON.parse(await readFile(new URL("../datasets/"+name,import.meta.url),"utf8"));data.features.push(...part.features);}
    data.metadata.source=profile==="commercial"?"NGA · WRI":"NGA · WRI · SWPC";
  }
  if (data.type !== "FeatureCollection")
    throw Error("Expected a WGS84 GeoJSON FeatureCollection.");
  const features = data.features
    .filter((f) => {
      const b = extent(f);
      return b[0] <= 60 && b[2] >= 32 && b[1] <= 33 && b[3] >= 12;
    })
    .map((f, i) => {
      const p = f.properties || {};
      if (!p.source || !safeLink(p.source_url, null))
        throw Error("Dataset features need source and HTTPS source_url.");
      return feature(id, f.id ?? p.id ?? i, f.geometry, {
        ...p,
        title: p.title || p.name || id,
        source: p.source,
        source_url: p.source_url,
        timestamp: utc(p.timestamp),
        severity: numeric(p.severity),
      });
    });
  return { features, provider: data.metadata?.source };
}
