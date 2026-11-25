import test from "node:test";
import assert from "node:assert/strict";
import { decode } from "fast-png";
import { applyMask, fillMissing, validDate } from "../daily-imagery.mjs";
import { sceneInfo, rankedScenes } from "../imagery.mjs";
import { availableDay } from "../gibs-dates.mjs";

test("daily publication gaps report the previous available day without filling it in", () => {
  const values = ["2024-01-01/2024-01-03/P1D", "2024-01-05"];
  assert.deepEqual(availableDay(values, "2024-01-02"), {
    available: true,
    latest: "2024-01-02",
  });
  assert.deepEqual(availableDay(values, "2024-01-04"), {
    available: false,
    latest: "2024-01-03",
  });
  assert.deepEqual(availableDay(values, "2023-12-31"), {
    available: false,
    latest: null,
  });
});
test("overlapping granules prefer coverage around town for the same pass and similar cloud", () => {
  const scene = (bbox, cloud) => ({
    bbox,
    collection: "sentinel-2-l2a",
    properties: { datetime: "2026-11-20T07:31:29Z", "eo:cloud_cover": cloud },
  });
  const edge = scene([44.99, 25.224, 46.09, 26.21], 0.001);
  const inside = scene([44.99, 24.321, 46.09, 25.316], 0.002);
  assert.equal(
    rankedScenes([edge, inside], "sentinel-2-l2a", {
      lon: 45.251,
      lat: 25.24,
    })[0],
    inside,
  );
});

test("a MODIS gap is masked using the NASA coverage flag, including valid dark water", () => {
  const rgb = {
    data: new Uint8Array([0, 0, 0, 0, 0, 0, 55, 92, 33, 175, 160, 128]),
    stride: 3,
  };
  const mask = {
    data: new Uint8Array([
      0, 0, 0, 0, 202, 170, 86, 255, 0, 0, 0, 0, 0, 0, 0, 0,
    ]),
    stride: 4,
  };
  const result = decode(applyMask(rgb, mask, 2));
  assert.deepEqual(
    [...result.data],
    [0, 0, 0, 255, 0, 0, 0, 0, 55, 92, 33, 255, 175, 160, 128, 255],
  );
  assert.equal(validDate("2025-02-30"), false);
});
test("same-day composition preserves valid dark water and leaves mutually unobserved pixels transparent", () => {
  const primary = Uint8Array.from([0,0,0,255, 1,2,3,0, 0,0,0,0]);
  const secondary = Uint8Array.from([90,80,70,255, 10,20,30,255, 3,5,6,0]);
  assert.deepEqual([...fillMissing(primary,secondary)],[0,0,0,255,10,20,30,255,0,0,0,0]);
});

test("Landsat search restricts the sensor and prefers recent usable acquisitions", () => {
  const item = (id, date, cloud, platform) => ({
    id,
    collection: "landsat-c2-l2",
    properties: { datetime: date, platform, "eo:cloud_cover": cloud },
  });
  const clear = item("clear", "2020-04-02", 11, "landsat-8");
  assert.equal(
    rankedScenes(
      [
        item("wrong", "2020-04-03", 0, "landsat-7"),
        item("cloudy", "2020-04-03", 91, "landsat-9"),
        clear,
        item("older", "2020-03-30", 1, "landsat-8"),
      ],
      "landsat-c2-l2",
    )[0],
    clear,
  );
});
test("strict day and lookback search the point and report provider outages independently of empty results", async () => {
  const original = globalThis.fetch,
    calls = [];
  try {
    globalThis.fetch = async (input) => {
      calls.push(new URL(input));
      return Response.json({ features: [] });
    };
    const q = {
      date: "2023-10-02",
      lat: 25.24,
      lon: 45.25,
      collection: "sentinel-2-l2a",
    };
    for (const days of [0, 30])
      await assert.rejects(sceneInfo({ ...q, lookback: days }), {
        status: 404,
        code: "no_scene",
      });
    assert.equal(
      calls[0].searchParams.get("datetime"),
      "2023-10-02T00:00:00Z/2023-10-02T23:59:59Z",
    );
    assert.match(calls[1].searchParams.get("datetime"), /^2023-09-02/);
    assert.deepEqual(JSON.parse(calls[0].searchParams.get("intersects")), {
      type: "Point",
      coordinates: [45.25, 25.24],
    });
    globalThis.fetch = async () => new Response(null, { status: 403 });
    await assert.rejects(sceneInfo(q), { status: 502, code: "provider" });
    await assert.rejects(sceneInfo({ ...q, lookback: 400 }), {
      status: 400,
      code: "invalid_query",
    });
  } finally {
    globalThis.fetch = original;
  }
});
