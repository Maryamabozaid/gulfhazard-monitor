import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { slick, fire } from "../priority.mjs";
import { day } from "../net.mjs";
import { restriction } from "../licensing.mjs";
delete process.env.DATABASE_URL;
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "gulfhazard-test-"));
const { getLayer, validateWindow, db } = await import("../store.mjs");
const { addRule, rules } = await import("../alerts.mjs");
after(() => db.close());
const capture = (name) =>
  JSON.parse(
    gunzipSync(
      readFileSync(
        new URL("../../datasets/" + name + ".json.gz", import.meta.url),
      ),
    ),
  );
test("rejects malformed, inverted, excessive, and impossible time windows", () => {
  assert.equal(validateWindow("2025-02-30", "2025-04-01"), false);
  assert.equal(validateWindow("2023-01-01", "2025-02-01"), false);
  assert.equal(validateWindow("2024-02-03", "2024-02-02"), false);
  assert.equal(validateWindow("2024-02-29", "2024-03-01"), true);
});
test("Cerulean retains upstream area, UTC acquisition, geometry and exact scene", {skip:!!restriction("oil")}, () => {
  const raw = capture("cerulean-regional-7d").features[0],
    out = slick(raw),
    p = out.properties;
  assert.equal(p.area_km2, raw.properties.area / 1e6);
  assert.equal(p.scene, raw.properties.s1_scene_id);
  assert.match(p.timestamp, /Z$/);
  assert.equal(p.confidence, raw.properties.slick_confidence);
  assert.deepEqual(out.geometry, raw.geometry);
});
test("FIRMS preserves sensor time, position and FRP", () => {
  const p = capture("firms-noaa20-regional-7d").features[0].properties,
    f = fire(p);
  assert.deepEqual(f.geometry.coordinates, [+p.longitude, +p.latitude]);
  assert.equal(f.properties.severity, +p.frp);
  assert.equal(Date.parse(f.properties.timestamp), Date.parse(p.timestamp));
});
test("a provider outage returns real cached coverage and never marks it current", {skip:!!restriction("oil")}, async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("access denied", { status: 403 });
  try {
    const c = capture("cerulean-regional-7d"),
      start = c.metadata.requestedWindowStart.slice(0, 10),
      end = c.metadata.requestedWindowEnd.slice(0, 10);
    const r = await getLayer("oil", start, end);
    assert.equal(r.status, "stale");
    assert.equal(r.lastSuccess, c.metadata.retrievedAt);
    assert.equal(r.features.length, c.features.length);
    assert.deepEqual(r.coverage, [
      c.metadata.requestedWindowStart,
      c.metadata.requestedWindowEnd,
    ]);
    const outside = await getLayer("oil", "2010-01-01", "2010-01-02");
    assert.equal(outside.status, "error");
    assert.equal(outside.features.length, 0);
  } finally {
    globalThis.fetch = original;
  }
});
test("bundled GIS inventories have provenance, stable identifiers and numeric metrics", async () => {
  for (const id of [
    "vessels",
    "infrastructure",
    "seismic",
    "flaring",
    "subsidence",
  ]) {
    const out = await getLayer(id, "2024-01-01", "2024-01-01");
    if(restriction(id)){assert.equal(out.status,"setup");assert.equal(out.features.length,0);continue;}
    assert.equal(out.status, "ok");
    assert.ok(out.features.length > 0);
    assert.equal(
      new Set(out.features.map((f) => f.id)).size,
      out.features.length,
    );
    for (const f of out.features) {
      assert.match(f.properties.source_url, /^https:\/\//);
      assert.equal(f.properties.timestamp, null);
      assert.equal(typeof f.properties.severity, "number");
    }
  }
});
test("alert rules validate geographic scope, radius and destination", async () => {
  const r = {
    name: "Regional quake watch",
    layer: "earthquakes",
    center: [46.675, 24.71],
    radius: 200,
    minimum: 4.5,
    channel: "inbox",
  };
  await assert.rejects(() => addRule({ ...r, center: [4, 55] }));
  await assert.rejects(() => addRule({ ...r, radius: 0 }));
  await assert.rejects(() => addRule({ ...r, channel: "unknown" }));
  const id = await addRule(r);
  assert.equal((await rules())[0].id, id);
});
