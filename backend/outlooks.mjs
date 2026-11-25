import { readFile } from "node:fs/promises";
import {
  BOX,
  inside,
  json,
  params,
  point,
  feature,
  numeric,
  utc,
  day,
  SetupError,
} from "./net.mjs";
const riverFile = JSON.parse(
  await readFile(
    new URL("../gis/public/cartography/water.geojson", import.meta.url),
    "utf8",
  ),
);
const rivers = new Map();
for (const f of riverFile.features) {
  const name = f.properties.name;
  if (
    !["Tigris", "Euphrates", "Nile", "Shat El Arab"].includes(name) ||
    rivers.has(name)
  )
    continue;
  const v = (
    f.geometry.type === "MultiLineString"
      ? f.geometry.coordinates.flat()
      : f.geometry.coordinates
  ).filter(inside);
  if (v.length) rivers.set(name, v[Math.floor(v.length / 2)]);
}
export async function discharge(start, end) {
  const values = [...rivers.values()],
    current = end === day(Date.now());
  const dateQuery = current
    ? { forecast_days: 7 }
    : { start_date: end, end_date: end };
  const url = params("https://flood-api.open-meteo.com/v1/flood", {
    latitude: values.map((p) => p[1]).join(","),
    longitude: values.map((p) => p[0]).join(","),
    daily: "river_discharge",
    ...dateQuery,
  });
  const list = await json(url),
    features = [];
  for (const [i, item] of (Array.isArray(list) ? list : [list]).entries()) {
    const outlook = item.daily.time
      .map((d, i) => ({
        day: d,
        value: numeric(item.daily.river_discharge[i]),
      }))
      .filter((d) => d.value !== null);
    if (!outlook.length) continue;
    const name = [...rivers.keys()][i];
    features.push(
      feature(
        "discharge",
        name + "-" + end,
        point(item.longitude, item.latitude),
        {
          title: name,
          severity: Math.max(...outlook.map((d) => d.value)),
          timestamp: null,
          valid_from: outlook[0].day,
          valid_to: outlook.at(-1).day,
          outlook,
          units: "m³/s",
          source: "Copernicus GloFAS / Open-Meteo",
          source_url: url.href,
        },
      ),
    );
  }
  return { features };
}
export async function stations(start, end) {
  const key = process.env.OPENAQ_API_KEY;
  if (!key)
    throw new SetupError(
      "Configure OPENAQ_API_KEY to read station measurements.",
    );
  const headers = { "X-API-Key": key },
    base = "https://api.openaq.org/v3/locations";
  const locations = await json(
    params(base, { bbox: BOX.join(","), parameters_id: 2, limit: 25 }),
    { headers },
  );
  const features = [];
  let misses = 0;
  for (const location of locations.results) {
    try {
      const id = location.id,
        data = await json(base + "/" + id + "/latest", { headers });
      for (const r of data.results) {
        const sensor = location.sensors?.find((s) => s.id === r.sensorsId);
        if (sensor?.parameter?.name !== "pm25" || numeric(r.value) === null)
          continue;
        const ts = utc(r.datetime?.utc),
          c = r.coordinates || location.coordinates;
        if (!ts || ts.slice(0, 10) < start || ts.slice(0, 10) > end) continue;
        features.push(
          feature(
            "stations",
            id + "-" + r.sensorsId + "-" + ts,
            point(c.longitude, c.latitude),
            {
              title: location.name,
              timestamp: ts,
              severity: r.value,
              units: sensor.parameter.units,
              source:
                "OpenAQ / " + (location.provider?.name || "monitoring station"),
              source_url: "https://explore.openaq.org/locations/" + id,
            },
          ),
        );
      }
    } catch {
      misses++;
    }
  }
  if (locations.results.length && misses === locations.results.length)
    throw Error("Provider could not supply current readings.");
  return {
    features,
    partial:
      misses || locations.results.length === 25
        ? "Latest PM2.5 readings from up to 25 regional locations."
        : "",
  };
}
const histories = new Map();
export async function eruptionHistory(id) {
  if (!/^\d{6}$/.test(id)) throw Error("Invalid volcano number.");
  const previous = histories.get(id);
  if (previous && previous.until > Date.now()) return previous.rows;
  const data = await json(
    params("https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows", {
      service: "WFS",
      version: "1.0.0",
      request: "GetFeature",
      typeName: "GVP-VOTW:Smithsonian_VOTW_Holocene_Eruptions",
      outputFormat: "application/json",
      CQL_FILTER: "Volcano_Number=" + id,
      maxFeatures: 500,
    }),
  );
  const rows = data.features
    .map((f) => ({
      id: f.properties.Eruption_Number,
      year: f.properties.StartDateYear,
      end: f.properties.EndDateYear,
      vei: f.properties.ExplosivityIndexMax,
      activity: f.properties.Activity_Type,
    }))
    .sort((a, b) => b.year - a.year);
  histories.set(id, { rows, until: Date.now() + 864e5 });
  return rows;
}
