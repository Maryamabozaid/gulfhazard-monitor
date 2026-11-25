import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { chromium } from "playwright-core";
import { checkCompare, compareFixture } from "./compare-check.mjs";
import { checkPlaceFilter } from "./place-filter-check.mjs";
import { fire, slick, quake } from "../backend/priority.mjs";
import {restriction} from "../backend/licensing.mjs";

// Exercise the production UI without a GPU or external map tiles. Use the
// shipped, dated provider captures so a legitimately empty live day also passes.
const origin = new URL(process.env.APP_URL || "http://127.0.0.1:5173").origin;
const samples = {};
for (const [layer, file, normalize] of [
  ["fires", "firms-noaa20-regional-7d", (f) => fire(f.properties)],
  ["oil", "cerulean-regional-7d", slick],
  ["earthquakes", "usgs-regional-30d", (f) => quake(f)],
]) {
  if(restriction(layer))continue;
  const fileUrl = new URL("../datasets/" + file + ".json.gz", import.meta.url);
  const capture = JSON.parse(gunzipSync(await readFile(fileUrl)));
  samples[layer] = {
    type: "FeatureCollection",
    features: capture.features.map(normalize),
    status: "stale",
    provider: capture.metadata.provider,
    lastSuccess: capture.metadata.retrievedAt,
    coverage: [
      capture.metadata.requestedWindowStart,
      capture.metadata.requestedWindowEnd,
    ],
    message: "Dated provider capture.",
  };
}
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: "chrome" }),
  headless: true,
  args: ["--disable-webgl"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    hasTouch: true,
  });
  const errors = [];
  const imagery = compareFixture();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date(samples.fires.lastSuccess));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin !== origin &&
      url.protocol !== "blob:" &&
      url.protocol !== "data:"
    )
      return route.abort();
    const sample = samples[url.pathname.replace("/api/layers/", "")];
    if (url.pathname === "/api/imagery/dates") return route.fulfill({json:{available:true,sources:["true","aqua","noaa20"]}});
    if (url.pathname.startsWith("/api/modis/")) return imagery.respond(route, url.pathname.split("/")[3]);
    if (sample) return route.fulfill({ json: sample });
    return route.continue();
  });
  await page.goto(origin);
  const button = (name) => page.getByRole("button", { name, exact: true });
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".leaflet-land-pane svg path[d]").length > 30 &&
      document.querySelectorAll(".leaflet-borders-pane path[d]").length > 30 &&
      document.querySelectorAll(".cluster-symbol").length > 2,
  );
  const scale = page.locator(".leaflet-control-scale-line");
  await checkPlaceFilter(page);
  const initialScale = await scale.innerText();
  await page.mouse.move(630, 410);
  await page.mouse.wheel(0, -550);
  await page.waitForFunction(
    (s) =>
      document.querySelector(".leaflet-control-scale-line").textContent !== s,
    initialScale,
  );
  const zoomedScale = await scale.innerText();
  const transform = () =>
    page.locator(".leaflet-map-pane").getAttribute("style");
  const start = await transform();
  await page.mouse.move(610, 470);
  await page.mouse.down();
  await page.mouse.move(795, 430, { steps: 12 });
  await page.mouse.up();
  assert.notEqual(await transform(), start, "drag must change map position");
  await page.mouse.wheel(0, 550);
  await page.waitForFunction(
    (s) =>
      document.querySelector(".leaflet-control-scale-line").textContent !== s,
    zoomedScale,
  );
  await button("Fit region").click();
  await page.locator(".event").first().click();
  await page.locator(".detail").waitFor();
  await page.keyboard.press("Escape");
  await button("Fit region").click();
  await button("Export map & data").click();
  await page.locator(".panel-body select").selectOption("png");
  const file = page.waitForEvent("download");
  await button("Export file").click();
  const download = await file;
  assert.equal(await download.failure(), null);
  const png = await readFile(await download.path());
  assert.ok(
    png.length > 15000 && png.subarray(1, 4).toString() === "PNG",
    "map PNG must contain rendered geography",
  );
  await page.keyboard.press("Escape");
  await button("Compare").click();
  await checkCompare(page, imagery);
  await button("Explore").click();
  await button("Area of interest").click();
  await button("Rectangle").click();
  await page.mouse.click(570,370);
  await page.mouse.click(775,545);
  await page.locator(".kpis").waitFor();
  await button("Clear drawing").click();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: geography, hazards, map navigation and PNG export. Compared dated pixels by mouse, keyboard and touch, including Arabic, same-date and failed-date states.",
  );
} finally {
  await browser.close();
}
