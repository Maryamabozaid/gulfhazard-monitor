import { encode } from "fast-png";
import { fromArrayBuffer } from "geotiff";
import { params, request, json, addDays, inside } from "./net.mjs";
import { validDate } from "./daily-imagery.mjs";
const pc = "https://planetarycomputer.microsoft.com/api",
  collection = "sentinel-1-rtc",
  size = 192;
const fail = (status, code, message) =>
  Object.assign(Error(message), { status, code });
const cache = new Map(),
  pending = new Map();
async function scenes(date, lon, lat) {
  const j = await json(
    params(pc + "/stac/v1/search", {
      collections: collection,
      intersects: JSON.stringify({ type: "Point", coordinates: [lon, lat] }),
      datetime: addDays(date, -12) + "T00:00:00Z/" + date + "T23:59:59Z",
      limit: 100,
    }),
  );
  return j.features
    .filter(
      (f) =>
        f.assets.vv &&
        f.properties["sar:instrument_mode"] === "IW" &&
        Number.isFinite(f.properties["sat:relative_orbit"]),
    )
    .sort((a, b) => b.properties.datetime.localeCompare(a.properties.datetime));
}
const track = (f) =>
  [
    f.properties.platform,
    f.properties["sat:relative_orbit"],
    f.properties["sat:orbit_state"],
    f.properties["sar:instrument_mode"],
  ].join("/");
export function radarPair(a, b, referenceDay) {
  for (const after of b) {
    if (after.properties.datetime.slice(0, 10) <= referenceDay) continue;
    for (const before of a)
      if (
        track(before) === track(after) &&
        before.id !== after.id &&
        before.properties.datetime.slice(0, 10) <
          after.properties.datetime.slice(0, 10)
      )
        return [before, after];
  }
  return null;
}
function footprint(lon, lat) {
  const R = 6378137,
    k = Math.PI / 180,
    cx = R * lon * k,
    cy = R * Math.log(Math.tan(Math.PI / 4 + (lat * k) / 2)),
    half = 4800 / Math.cos(lat * k);
  return [
    (cx - half) / R / k,
    Math.atan(Math.sinh((cy - half) / R)) / k,
    (cx + half) / R / k,
    Math.atan(Math.sinh((cy + half) / R)) / k,
  ];
}
async function readBand(item, bounds) {
  const u = params(
    pc +
      "/data/v1/item/bbox/" +
      bounds.join(",") +
      "/" +
      size +
      "x" +
      size +
      ".tif",
    {
      collection,
      item: item.id,
      assets: "vv",
      coord_crs: "EPSG:4326",
      dst_crs: "EPSG:3857",
      resampling: "nearest",
      return_mask: "false",
    },
  );
  const res = await request(u);
  const image = await (
    await fromArrayBuffer(await res.arrayBuffer())
  ).getImage();
  if (image.getWidth() !== size || image.getHeight() !== size)
    throw Error("Unexpected raster grid.");
  const a = await image.readRasters({ samples: [0], interleave: true }),
    nodata = image.getGDALNoData();
  return Float32Array.from(a, (v) =>
    Number.isFinite(v) && v > 0 && v !== nodata ? 10 * Math.log10(v) : NaN,
  );
}
// Median suppresses isolated speckle. Keep the original invalid footprint.
function denoise(input) {
  return input.map((v, i) => {
    if (!Number.isFinite(v)) return NaN;
    const x = i % size,
      y = Math.floor(i / size),
      values = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (x + dx < 0 || x + dx >= size || y + dy < 0 || y + dy >= size)
          continue;
        const n = input[i + dy * size + dx];
        if (Number.isFinite(n)) values.push(n);
      }
    return values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  });
}
export function classify(after, before) {
  const hist = new Uint32Array(80);
  let count = 0,
    sum = 0;
  for (const v of after)
    if (Number.isFinite(v)) {
      const j = Math.max(0, Math.min(79, Math.floor((v + 40) * 2)));
      hist[j]++;
      count++;
      sum += j;
    }
  let best = -1,
    threshold = -17,
    n = 0,
    subtotal = 0;
  for (let j = 0; j < 79; j++) {
    n += hist[j];
    subtotal += hist[j] * j;
    if (!n || n === count) continue;
    const score =
      n * (count - n) * (subtotal / n - (sum - subtotal) / (count - n)) ** 2;
    if (score > best) {
      best = score;
      threshold = Math.min(-13, Math.max(-22, -40 + (j + 0.5) / 2));
    }
  }
  const rgba = new Uint8Array(after.length * 4);
  let valid = 0,
    water = 0,
    decreased = 0,
    increased = 0;
  for (let i = 0; i < after.length; i++) {
    const v = after[i];
    if (!Number.isFinite(v) || (before && !Number.isFinite(before[i])))
      continue;
    valid++;
    if (v < threshold) water++;
    let color;
    if (!before && v < threshold) color = [35, 140, 214, 195];
    if (before && v - before[i] <= -3) {
      decreased++;
      color = [34, 115, 216, 190];
    }
    if (before && v - before[i] >= 3) {
      increased++;
      color = [221, 128, 35, 190];
    }
    if (color) rgba.set(color, 4 * i);
  }
  return { rgba, valid, water, threshold, decreased, increased };
}
export async function radarAnalysis({ lon, lat, date, before, mode }) {
  if (
    !["water", "change"].includes(mode) ||
    !validDate(date) ||
    !Number.isFinite(+lon) ||
    !Number.isFinite(+lat) ||
    !inside([+lon, +lat]) ||
    (mode === "change" && (!validDate(before) || before >= date))
  )
    throw fail(
      400,
      "invalid_query",
      "Select an earlier reference day and a centre inside the study region.",
    );
  const key = [mode, +lon, +lat, date, mode === "change" ? before : ""].join(
    "|",
  );
  if (cache.get(key)?.until > Date.now()) return cache.get(key).result;
  if (pending.has(key)) return pending.get(key);
  const job = (async () => {
    const [b, a] = await Promise.all([
      scenes(date, +lon, +lat),
      mode === "change" ? scenes(before, +lon, +lat) : [],
    ]);
    const pair =
      mode === "change" ? radarPair(a, b, before) : b.length ? [b[0]] : null;
    if (!pair)
      throw fail(
        404,
        mode === "change" ? "no_pair" : "no_scene",
        "No compatible radar acquisition covers the focus in the search windows.",
      );
    const bounds = footprint(+lon, +lat);
    const bands = await Promise.all(
      pair.map(async (f) => denoise(await readBand(f, bounds))),
    );
    const out = classify(bands.at(-1), bands.length === 2 ? bands[0] : null);
    if (out.valid < 200)
      throw fail(404, "no_pixels", "Insufficient valid radar pixels.");
    const items = pair.map((f) => ({
      id: f.id,
      date: f.properties.datetime,
      orbit: track(f),
      url: pc + "/stac/v1/collections/" + collection + "/items/" + f.id,
    }));
    const result = {
      id: mode + "-" + pair.at(-1).id,
      product: mode,
      name:
        mode === "water"
          ? "Sentinel-1 · water candidates"
          : "Sentinel-1 · backscatter change",
      attribution: "Microsoft Planetary Computer · Sentinel-1 RTC",
      date: items.at(-1).date,
      requestedDate: date,
      bounds,
      tiles: [],
      url: items.at(-1).url,
      items,
      valid: out.valid,
      water: out.water,
      decreased: out.decreased,
      increased: out.increased,
      threshold: out.threshold,
      resolutionLabel: "~50 m",
      overlay:
        "data:image/png;base64," +
        Buffer.from(
          encode({ width: size, height: size, channels: 4, data: out.rgba }),
        ).toString("base64"),
    };
    if (cache.size >= 48) cache.delete(cache.keys().next().value);
    cache.set(key, { result, until: Date.now() + 3600000 });
    return result;
  })().finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}
