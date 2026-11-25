import { decode, encode, convertIndexedToRgb } from "fast-png";
import { params, request } from "./net.mjs";

const wms = "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi";
export const viirs = "VIIRS_NOAA20_CorrectedReflectance_TrueColor";
export function validDate(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return false;
  const time = Date.parse(date);
  return (
    Number.isFinite(time) &&
    new Date(time).toISOString().startsWith(date) &&
    time <= Date.now()
  );
}
async function pixels(layer, date, bounds, size) {
  const res = await request(
    params(wms, {
      SERVICE: "WMS",
      VERSION: "1.3.0",
      REQUEST: "GetMap",
      LAYERS: layer,
      STYLES: "",
      FORMAT: "image/png",
      TRANSPARENT: "TRUE",
      CRS: "EPSG:3857",
      BBOX: bounds.join(","),
      WIDTH: size,
      HEIGHT: size,
      TIME: date,
    }),
  );
  if (!res.headers.get("content-type")?.includes("image/png"))
    throw Error("NASA GIBS did not return imagery.");
  const info = decode(new Uint8Array(await res.arrayBuffer()));
  const data = info.palette ? convertIndexedToRgb(info) : info.data;
  const stride = data.length / (size * size);
  if (info.width !== size || info.height !== size || ![3, 4].includes(stride))
    throw Error("Invalid NASA GIBS tile.");
  return { data, stride };
}
// NASA classifies the opaque gold mask pixels as No Data. Reflectance colour
// alone cannot distinguish a dark surface from a gap between satellite passes.
function maskedPixels(image, mask, size) {
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const pos = i * image.stride,
      m = i * mask.stride,
      k = i * 4;
    rgba[k] = image.data[pos];
    rgba[k + 1] = image.data[pos + 1];
    rgba[k + 2] = image.data[pos + 2];
    const missing =
      mask.data[m] === 202 &&
      mask.data[m + 1] === 170 &&
      mask.data[m + 2] === 86 &&
      (mask.stride === 3 || mask.data[m + 3] > 0);
    rgba[k + 3] = missing ? 0 : image.stride === 4 ? image.data[pos + 3] : 255;
  }
  return rgba;
}
function png(data, size) {
  return Buffer.from(
    encode({ width: size, height: size, channels: 4, depth: 8, data }),
  );
}
export function applyMask(image, mask, size) {
  return png(maskedPixels(image, mask, size), size);
}
export function fillMissing(primary, secondary) {
  for (let i = 0; i < primary.length; i += 4) {
    if (!primary[i + 3] && secondary[i + 3])
      primary.set(secondary.subarray(i, i + 4), i);
  }
  return primary;
}
async function sensorPixels(platform, date, bounds) {
  const prefix = "MODIS_" + platform;
  const [rgb, mask] = await Promise.all([
    pixels(prefix + "_CorrectedReflectance_TrueColor", date, bounds, 256),
    pixels(prefix + "_Data_No_Data", date, bounds, 256),
  ]);
  return maskedPixels(rgb, mask, 256);
}
function hasGaps(rgba) {
  for (let i = 3; i < rgba.length; i += 4) if (!rgba[i]) return true;
  return false;
}
async function compositeTile(sensors, date, bounds) {
  let primary;
  for (const sensor of sensors) {
    if (sensor === "noaa20") {
      primary ??= new Uint8Array(256 * 256 * 4);
      const img = await pixels(viirs, date, bounds, 256);
      for (let i = 0; i < 256 * 256; i++) {
        const k = i * 4,
          p = i * img.stride;
        // GIBS true colour can encode empty VIIRS footprints as opaque black.
        // Only use affirmative reflectance in missing MODIS pixels.
        if (
          !primary[k + 3] &&
          (img.stride === 3 || img.data[p + 3]) &&
          (img.data[p] || img.data[p + 1] || img.data[p + 2])
        ) {
          primary[k] = img.data[p];
          primary[k + 1] = img.data[p + 1];
          primary[k + 2] = img.data[p + 2];
          primary[k + 3] = 255;
        }
      }
    } else {
      const data = await sensorPixels(
        sensor === "aqua" ? "Aqua" : "Terra",
        date,
        bounds,
      );
      primary = primary ? fillMissing(primary, data) : data;
    }
    if (!hasGaps(primary)) break;
  }
  return png(primary, 256);
}
const cache = new Map(),
  pending = new Map();
export async function modisTile(date, z, x, y, sensors = ["true"]) {
  if (
    !validDate(date) ||
    !Array.isArray(sensors) ||
    !sensors.length ||
    sensors.length > 3 ||
    !sensors.every((s) => ["true", "aqua", "noaa20"].includes(s)) ||
    ![z, x, y].every(Number.isInteger) ||
    z < 0 ||
    z > 9 ||
    x < 0 ||
    y < 0 ||
    x >= 2 ** z ||
    y >= 2 ** z
  )
    throw Object.assign(Error("Invalid NASA tile."), { status: 400 });
  const key = [sensors.join("+"), date, z, x, y].join("/"),
    prev = cache.get(key);
  if (prev && prev.until > Date.now()) return prev.value;
  if (pending.has(key)) return pending.get(key);
  const extent = 20037508.342789244,
    span = (2 * extent) / 2 ** z;
  const bounds = [
    -extent + x * span,
    extent - (y + 1) * span,
    -extent + (x + 1) * span,
    extent - y * span,
  ];
  const job = compositeTile(sensors, date, bounds)
    .then((value) => {
      if (cache.size >= 160) cache.delete(cache.keys().next().value);
      cache.set(key, { value, until: Date.now() + 3600000 });
      return value;
    })
    .finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

export async function overviewAt(date, lon, lat) {
  const x = (lon * 20037508.342789244) / 180,
    y = 6378137 * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const area = [x - 500, y - 500, x + 500, y + 500];
  const img = await pixels(viirs, date, area, 4);
  // GIBS serves an all-black JPEG footprint for missing VIIRS data. Require a
  // positive colour signal before offering this daily overview at the focus.
  for (let i = 0; i < img.data.length; i += img.stride) {
    if (
      (img.stride === 3 || img.data[i + 3]) &&
      Math.max(img.data[i], img.data[i + 1], img.data[i + 2]) > 0
    )
      return {
        id: "noaa20",
        name: "VIIRS · NOAA-20",
        date,
        attribution: "NASA GIBS",
        resolutionLabel: "375–750 m",
        nativeZoom: 9,
        tiles: [
          "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/" +
            viirs +
            "/default/" +
            date +
            "/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg",
        ],
      };
  }
  return null;
}
