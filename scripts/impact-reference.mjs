import { writeFile } from "node:fs/promises";
const url = new URL(
  "https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/earthquakes",
);
for (const [key, value] of Object.entries({
  minYear: 1900,
  maxYear: 2025,
  minLongitude: 32,
  maxLongitude: 60,
  minLatitude: 12,
  maxLatitude: 33,
  pageSize: 2000,
}))
  url.searchParams.set(key, value);
const r = await fetch(url, { signal: AbortSignal.timeout(45000) });
if (!r.ok) throw Error("NOAA returned " + r.status);
const data = await r.json();
if (data.totalItems !== data.items.length)
  throw Error("Incomplete NOAA catalogue");
const events = data.items.map((e) => ({
  id: e.id,
  year: e.year,
  month: e.month || null,
  day: e.day || null,
  country: e.country,
  magnitude: e.eqMagnitude ?? null,
  damageClass: e.damageAmountOrder ?? null,
  deaths: e.deaths ?? null,
}));
const assessed = events.filter(
  (e) => e.magnitude != null && [1, 2, 3, 4].includes(e.damageClass),
);
const train = assessed.filter((e) => e.year < 2015),
  held = assessed.filter((e) => e.year >= 2015);
const band = (m) => (m < 6 ? "M < 6" : m < 7 ? "6 ≤ M < 7" : "M ≥ 7");
const severe = (e) => Number(e.damageClass >= 3);
const fit = (rows) => ({ n: rows.length, severe: rows.filter(severe).length });
const bins = Object.fromEntries(
  ["M < 6", "6 ≤ M < 7", "M ≥ 7"].map((k) => [
    k,
    fit(train.filter((e) => band(e.magnitude) === k)),
  ]),
);
const overall = fit(train);
// Beta(1,1) smoothing applies equally to the baseline and magnitude grouping.
const estimate = (group) => (group.severe + 1) / (group.n + 2);
const brier = (pick) =>
  held.length
    ? held.reduce((v, e) => v + (estimate(pick(e)) - severe(e)) ** 2, 0) /
      held.length
    : null;
const result = {
  title: "NOAA NCEI/WDS Global Significant Earthquake Database",
  doi: "10.7289/V5TD9V7K",
  source: url.href,
  retrievedAt: new Date().toISOString(),
  years: [1900, 2025],
  assessed: assessed.length,
  training: train.length,
  holdout: held.length,
  bins,
  brier: brier((e) =>
    bins[band(e.magnitude)].n ? bins[band(e.magnitude)] : overall,
  ),
  baselineBrier: brier(() => overall),
  events,
};
await writeFile(
  new URL("../gis/public/cartography/impact-reference.json", import.meta.url),
  JSON.stringify(result),
);
console.log(JSON.stringify({ ...result, events: events.length }));
