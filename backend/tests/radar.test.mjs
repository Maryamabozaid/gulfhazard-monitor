import test from "node:test";
import assert from "node:assert/strict";
import { classify, radarPair } from "../radar.mjs";

test("water classification keeps unobserved pixels transparent and excludes them from counts", () => {
  const band = new Float32Array([-25, -23, -5, -3, NaN]);
  const r = classify(band);
  assert.equal(r.valid, 4);
  assert.equal(r.water, 2);
  assert.ok(r.threshold >= -22 && r.threshold <= -13);
  assert.equal(r.rgba[3], 195);
  assert.equal(r.rgba.at(-1), 0);
});
test("radar change counts only overlapping valid pixels and compatible acquisitions across target dates", () => {
  const ref = new Float32Array([-10, -10, -10, NaN]);
  const r = classify(new Float32Array([-14, -5, -9, -10]), ref);
  assert.deepEqual([r.valid, r.increased, r.decreased], [3, 1, 1]);
  const scene = (date, orbit) => ({
    id: date + orbit,
    properties: {
      platform: "S1A",
      "sat:relative_orbit": orbit,
      "sat:orbit_state": "descending",
      "sar:instrument_mode": "IW",
      datetime: date + "T02:04:00Z",
    },
  });
  const a = scene("2024-07-21", 6),
    b = scene("2024-08-02", 6);
  assert.deepEqual(radarPair([a], [scene("2024-08-03", 7), b], "2024-07-26"), [
    a,
    b,
  ]);
  assert.equal(radarPair([a], [b], "2024-08-02"), null);
});
