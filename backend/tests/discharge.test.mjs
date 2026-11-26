import test from "node:test";
import assert from "node:assert/strict";
import { discharge } from "../outlooks.mjs";

test("Saudi wadi queries preserve zero flow, skip missing cells, and honour the historical window", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    const q = url.searchParams;
    assert.equal(q.get("start_date"), "2024-01-01");
    assert.equal(q.get("end_date"), "2024-01-02");
    const lat = q.get("latitude").split(",").map(Number);
    const lon = q.get("longitude").split(",").map(Number);
    const hanifah = lat.findIndex((v, i) => v === 24.38848 && lon[i] === 46.82458);
    assert.ok(hanifah >= 0);
    assert.ok(lat.includes(16.96043), "includes the Jazan wadi");
    return Response.json(lat.map((_, i) => ({
      location_id: i, latitude: lat[i], longitude: lon[i],
      daily: {time:["2024-01-01","2024-01-02"], river_discharge: i === hanifah ? [0,0] : [null,null]},
    })).reverse());
  });
  const result = await discharge("2024-01-01", "2024-01-02");
  assert.equal(result.features.length, 1);
  const {geometry, properties} = result.features[0];
  assert.deepEqual(geometry.coordinates, [46.82458, 24.38848]);
  assert.equal(properties.title_ar, "وادي حنيفة");
  assert.equal(properties.severity, 0);
  assert.deepEqual(properties.outlook.map(d => d.value), [0, 0]);
  assert.deepEqual(result.coverage, ["2024-01-01","2024-01-02"]);
  assert.ok(result.partial);
});
