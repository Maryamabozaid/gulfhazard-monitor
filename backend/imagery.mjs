import {clientToken} from "./oauth.mjs";
import {restriction} from "./licensing.mjs";
import { validDate, overviewAt } from "./daily-imagery.mjs";
import { decode, convertIndexedToRgb } from "fast-png";
import { params, request, json, SetupError } from "./net.mjs";
import { readFile } from "node:fs/promises";
const catalogue = new Map();
const captured = restriction("oil")?{}:await readFile(
  new URL("../datasets/sar-catalogue.json", import.meta.url),
  "utf8",
)
  .then(JSON.parse)
  .catch(() => ({}));
const pc = "https://planetarycomputer.microsoft.com/api/stac/v1";
const collections = {
  "sentinel-1-grd": {name:"Sentinel-1",nativeZoom:16},
  "sentinel-2-l2a": { name: "Sentinel-2", resolution: 10, nativeZoom: 14 },
  "landsat-c2-l2": { name: "Landsat 8/9", resolution: 30, nativeZoom: 13 },
};
const error = (status, code, message) =>
  Object.assign(Error(message), { status, code });
function searchOptions({ date, lon, lat, lookback = 30 }) {
  if (
    !validDate(date) ||
    lon == null ||
    lat == null ||
    String(lon).trim() === "" ||
    String(lat).trim() === "" ||
    !Number.isFinite(+lon) ||
    !Number.isFinite(+lat) ||
    Math.abs(+lon) > 180 ||
    Math.abs(+lat) > 85 ||
    ![0, 7, 30].includes(Number(lookback))
  )
    throw error(
      400,
      "invalid_query",
      "Invalid imagery location, date or lookback.",
    );
  const start = new Date(Date.parse(date) - Number(lookback) * 86400000)
    .toISOString()
    .slice(0, 10);
  return { date, lon: +lon, lat: +lat, lookback: Number(lookback), start };
}
export function rankedScenes(items, collection, focus) {
  // Adjacent granules from the same pass overlap. Prefer the one containing
  // more of the town, even when cloud percentages differ by a tiny fraction.
  const margin = (f) => {
    if (!focus || !f.bbox) return 0;
    const [w, s, e, n] = f.bbox,
      { lon, lat } = focus;
    return Math.min(
      10,
      111 *
        Math.min(
          lat - s,
          n - lat,
          Math.cos((lat * Math.PI) / 180) * Math.min(lon - w, e - lon),
        ),
    );
  };
  return items
    .filter(
      (f) =>
        f.collection === collection &&
        f.properties?.datetime &&
        (collection !== "landsat-c2-l2" ||
          ["landsat-8", "landsat-9"].includes(f.properties.platform)),
    )
    .sort((a, b) => {
      const cloud = (f) => f.properties["eo:cloud_cover"] ?? 101;
      return (
        Number(cloud(a) > 60) - Number(cloud(b) > 60) ||
        b.properties.datetime
          .slice(0, 10)
          .localeCompare(a.properties.datetime.slice(0, 10)) ||
        Math.floor(cloud(a) / 10) - Math.floor(cloud(b) / 10) ||
        margin(b) - margin(a) ||
        cloud(a) - cloud(b)
      );
    });
}
const safePc = (href) => {
  try {
    const u = new URL(href);
    return u.origin === "https://planetarycomputer.microsoft.com";
  } catch {
    return false;
  }
};
async function rendered(item) {
  const href = item.assets?.tilejson?.href;
  if (!safePc(href))
    throw error(
      502,
      "renderer",
      "The matching scene has no accessible render service.",
    );
  const meta = await json(href);
  if (!meta.tiles?.length || !meta.tiles.every(safePc))
    throw error(
      502,
      "renderer",
      "Planetary Computer could not provide image tiles.",
    );
  const spec = collections[item.collection];
  return {
    id: item.id,
    collection: item.collection,
    tiles: meta.tiles,
    bounds: item.bbox,
    time: item.properties.datetime,
    platform: item.properties.platform || spec?.name || "Sentinel-1",
    resolution: item.properties.gsd ?? spec?.resolution ?? item.properties["sar:pixel_spacing_range"],
    nativeZoom: Math.min(meta.maxzoom ?? 18, spec?.nativeZoom ?? 18),
    cloudCover: item.properties["eo:cloud_cover"] ?? null,
    source: "Microsoft Planetary Computer · " + item.collection,
    url:
      pc +
      "/collections/" +
      encodeURIComponent(item.collection) +
      "/items/" +
      encodeURIComponent(item.id),
  };
}
async function resolveScene(q) {
  let candidates;
  if (q.scene) {
    if (!/^S1[A-D]_[A-Z0-9_]{35,100}$/.test(q.scene))
      throw error(400, "invalid_query", "Invalid Sentinel-1 identifier.");
    const short = q.scene.replace(/_[A-F0-9]{4}$/, "");
    const data = await json(
      params(pc + "/search", {
        collections: "sentinel-1-grd",
        ids: short + "," + q.scene,
        limit: 2,
      }),
    );
    candidates = data.features.filter(
      (f) => f.id === short || f.id === q.scene,
    );
  } else {
    const { collection } = q,
      { start, date, lon, lat } = searchOptions(q);
    if (!Object.hasOwn(collections, collection))
      throw error(400, "invalid_query", "Invalid imagery collection.");
    const fields = {
      collections: collection,
      datetime: start + "T00:00:00Z/" + date + "T23:59:59Z",
      intersects: JSON.stringify({ type: "Point", coordinates: [lon, lat] }),
      limit: 100,
    };
    const data = await json(params(pc + "/search", fields));
    candidates = rankedScenes(data.features, collection, { lon, lat });
  }
  if (!candidates.length)
    throw error(
      404,
      "no_scene",
      "No acquisition covers this location in the selected date window.",
    );
  let failure;
  for (const item of candidates.slice(0, 3)) {
    try {
      const info = await rendered(item);
      if (!q.scene && !(await hasPixelsAt(info, +q.lon, +q.lat))) continue;
      return info;
    } catch (e) {
      failure = e;
    }
  }
  throw (
    failure ||
    error(
      404,
      "no_pixels",
      "The matching scenes have no valid imagery at the map centre.",
    )
  );
}
async function hasPixelsAt(info, lon, lat) {
  const z = Math.min(12, info.nativeZoom),
    n = 2 ** z;
  const x = ((lon + 180) / 360) * n,
    y = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  const url = info.tiles[0]
    .replace("{z}", z)
    .replace("{x}", Math.floor(x))
    .replace("{y}", Math.floor(y));
  const res = await request(url);
  if (res.status === 204) return false;
  if (!res.headers.get("content-type")?.includes("image/png"))
    throw error(
      502,
      "renderer",
      "The scene renderer did not return PNG imagery.",
    );
  const img = decode(new Uint8Array(await res.arrayBuffer())),
    pixels = img.palette ? convertIndexedToRgb(img) : img.data;
  const stride = pixels.length / (img.width * img.height);
  const i =
    Math.floor((y % 1) * img.height) * img.width +
    Math.floor((x % 1) * img.width);
  return stride !== 4 || pixels[i * 4 + 3] > 0;
}
export async function sceneInfo(q) {
  const key =
    q.scene || [q.collection, q.date, q.lon, q.lat, q.lookback ?? 30].join("|");
  const previous = catalogue.get(key) || (q.scene ? captured[q.scene] : null);
  if (
    previous &&
    Date.now() - Date.parse(previous.metadataRetrievedAt) < 3600000
  )
    return { ...previous, metadataStatus: "cached" };
  try {
    const info = {
      ...(await resolveScene(q)),
      metadataRetrievedAt: new Date().toISOString(),
      metadataStatus: "current",
    };
    if (catalogue.size >= 300) catalogue.delete(catalogue.keys().next().value);
    catalogue.set(key, info);
    return info;
  } catch (e) {
    if (previous && e.status !== 400 && e.status !== 404)
      return { ...previous, metadataStatus: "stale" };
    if (e.status) throw e;
    throw error(
      502,
      "provider",
      "Planetary Computer is temporarily unavailable.",
    );
  }
}
function sceneImage(info, date) {
  return {
    id: info.id,
    name: info.platform
      .replace(/^sentinel-/i, "Sentinel-")
      .replace(/^landsat-/i, "Landsat ")
      .replace(/(\d)([abc])$/i, (_, n, letter) => n + letter.toUpperCase()),
    tiles: info.tiles,
    date: info.time,
    requestedDate: date,
    resolutionLabel: info.resolution + " m",
    nativeZoom: info.nativeZoom,
    attribution: info.source,
    url: info.url,
    bounds: info.bounds,
    cloudCover: info.cloudCover,
    metadataRetrievedAt: info.metadataRetrievedAt,
    metadataStatus: info.metadataStatus,
  };
}
const autoCache = new Map();
export async function autoImage(q) {
  const focus = searchOptions(q),
    band = q.band;
  if (!["overview", "medium", "fine"].includes(band))
    throw error(400, "invalid_query", "Invalid imagery scale.");
  const key = [focus.date, focus.lookback, focus.lon, focus.lat, band].join(
      "|",
    ),
    saved = autoCache.get(key);
  if (saved && saved.until > Date.now()) return saved.value;
  const remember = (image, reason) => {
    const value = { image, reason };
    if (autoCache.size >= 180) autoCache.delete(autoCache.keys().next().value);
    autoCache.set(key, { value, until: Date.now() + 600000 });
    return value;
  };
  let unavailable = false,
    cloudy,
    daily;
  const overview = async () => {
    try {
      return await overviewAt(focus.date, focus.lon, focus.lat);
    } catch {
      unavailable = true;
      return null;
    }
  };
  if (band === "overview") {
    daily = await overview();
    if (daily) return remember(daily, "overview");
  }
  const preference =
    band === "medium"
      ? ["landsat-c2-l2", "sentinel-2-l2a"]
      : ["sentinel-2-l2a", "landsat-c2-l2"];
  for (const collection of preference) {
    try {
      const info = await sceneInfo({ ...focus, collection }),
        image = sceneImage(info, focus.date);
      if (info.cloudCover === null || info.cloudCover <= 60)
        return remember(
          image,
          collection === preference[0] ? "matched" : "alternative",
        );
      if (!cloudy || image.cloudCover < cloudy.cloudCover) cloudy = image;
    } catch (e) {
      if (e.status !== 404) unavailable = true;
    }
  }
  if (cloudy) return remember(cloudy, "cloudy");
  if (band !== "overview") {
    daily = await overview();
    if (daily)
      return remember(daily, unavailable ? "coarse_outage" : "coarse_empty");
  }
  throw unavailable
    ? error(502, "provider", "One or more imagery services are unavailable.")
    : error(
        404,
        "no_scene",
        "No usable imagery was found at this location for the selected window.",
      );
}


export async function sentinelTile(product, date, z, x, y) {
  if (!process.env.CDSE_CLIENT_ID || !process.env.CDSE_CLIENT_SECRET)
    throw new SetupError("Configure Copernicus Data Space OAuth credentials.");
  if (
    !["s1", "s2", "ch4", "co"].includes(product) ||
    !/^\d{4}-\d\d-\d\d$/.test(date) ||
    ![z, x, y].every(Number.isInteger) ||
    z < 0 ||
    z > 16 ||
    x < 0 ||
    y < 0 ||
    x >= 2 ** z ||
    y >= 2 ** z
  )
    throw Error("Invalid tile.");
  const access=await clientToken("CDSE","https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token");
  const m = 20037508.342789244,
    span = (2 * m) / 2 ** z;
  const gas = product === "ch4" || product === "co";
  const band = product.toUpperCase();
  const script = gas
    ? `//VERSION=3\nfunction setup(){return {input:["${band}","dataMask"],output:{bands:4}}}\nfunction evaluatePixel(s){let v=Math.max(0,Math.min(1,${product === "ch4" ? "(s.CH4-1600)/400" : "s.CO/0.1"}));return [v,0.8*(1-v),1-v,s.dataMask*0.8]}`
    : product === "s2"
      ? `//VERSION=3
function setup(){return {input:["B12","B8A","B04","dataMask"],output:{bands:4}}}
function evaluatePixel(s){return [2.5*s.B12,2.5*s.B8A,2.5*s.B04,s.dataMask]}`
      : `//VERSION=3
function setup(){return {input:["VV","dataMask"],output:{bands:4}}}
function evaluatePixel(s){let b=Math.max(0,Math.min(1,(10*Math.log10(Math.max(s.VV,0.00001))+25)/25));return [b,b,b,s.dataMask]}`;
  const payload = {
    input: {
      bounds: {
        bbox: [
          -m + x * span,
          m - (y + 1) * span,
          -m + (x + 1) * span,
          m - y * span,
        ],
        properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/3857" },
      },
      data: [
        {
          type: gas
            ? "sentinel-5p-l2"
            : product === "s2"
              ? "sentinel-2-l2a"
              : "sentinel-1-grd",
          dataFilter: {
            timeRange: { from: date + "T00:00:00Z", to: date + "T23:59:59Z" },
          },
        },
      ],
    },
    output: {
      width: 256,
      height: 256,
      responses: [{ identifier: "default", format: { type: "image/png" } }],
    },
    evalscript: script,
  };
  const res = await request(
    "https://sh.dataspace.copernicus.eu/api/v1/process",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + access,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  return Buffer.from(await res.arrayBuffer());
}
