import { readFile } from "node:fs/promises";
import { request } from "./net.mjs";
import { validDate } from "./daily-imagery.mjs";

const identifiers = {
  true: "MODIS_Terra_CorrectedReflectance_TrueColor",
  aqua: "MODIS_Aqua_CorrectedReflectance_TrueColor",
  viirs: "VIIRS_SNPP_CorrectedReflectance_TrueColor",
  noaa20: "VIIRS_NOAA20_CorrectedReflectance_TrueColor",
};
const url =
  "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml";
let catalogue = JSON.parse(
    await readFile(
      new URL("../datasets/gibs-reflectance-dates.json", import.meta.url),
      "utf8",
    ),
  ),
  pending;
export function availableDay(values, date) {
  let latest = null;
  for (const value of values) {
    const [first, last = first, step] = value.split("/");
    if (step && step !== "P1D") continue;
    if (first <= date && date <= last) return { available: true, latest: date };
    if (last <= date && (!latest || last > latest)) latest = last;
  }
  return { available: false, latest };
}
async function refresh() {
  const xml = await (await request(url)).text();
  const intervals = {};
  for (const match of xml.matchAll(/<Layer(?:\s[^>]*)?>([\s\S]*?)<\/Layer>/g)) {
    const block = match[1],
      id = block.match(/<ows:Identifier>([^<]+)<\/ows:Identifier>/)?.[1];
    const entry = Object.entries(identifiers).find(([, name]) => name === id);
    if (!entry) continue;
    const time = block.match(
      /<Dimension>\s*<ows:Identifier>Time<\/ows:Identifier>([\s\S]*?)<\/Dimension>/i,
    )?.[1];
    const values = Array.from(
      (time || "").matchAll(
        /<Value>(\d{4}-\d{2}-\d{2}(?:\/\d{4}-\d{2}-\d{2}\/P1D)?)<\/Value>/g,
      ),
      (m) => m[1],
    );
    if (values.length) intervals[entry[0]] = values;
  }
  if (Object.keys(intervals).length !== Object.keys(identifiers).length)
    throw Error("NASA GIBS date catalogue unavailable.");
  catalogue = { retrievedAt: new Date().toISOString(), intervals };
}
export async function dailyDates({ product, date }) {
  if (
    (!Object.hasOwn(identifiers, product) &&
      !["mosaic", "daily"].includes(product)) ||
    !validDate(date)
  )
    throw Object.assign(Error("Invalid GIBS date or product."), {
      status: 400,
      code: "invalid_query",
    });
  let stale = false;
  if (Date.now() - Date.parse(catalogue.retrievedAt) > 3 * 3600000) {
    try {
      pending ??= refresh().finally(() => {
        pending = undefined;
      });
      await pending;
    } catch {
      stale = true;
    }
  }
  const candidates =
    product === "daily"
      ? ["true", "aqua", "noaa20"]
      : product === "mosaic"
        ? ["true", "aqua"]
        : [product];
  const days = candidates.map((id) =>
    availableDay(catalogue.intervals[id] || [], date),
  );
  const sources = candidates.filter((_, i) => days[i].available);
  const result = {
    available: !!sources.length,
    sources,
    latest:
      days
        .map((d) => d.latest)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null,
  };
  if (stale && !result.available)
    throw Object.assign(
      Error("NASA GIBS publication dates could not be refreshed."),
      { status: 502, code: "provider" },
    );
  return {
    ...result,
    metadataRetrievedAt: catalogue.retrievedAt,
    metadataStatus: stale ? "stale" : "cached",
    source: "NASA GIBS",
  };
}
