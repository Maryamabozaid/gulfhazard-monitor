import { area, featureCollection, union } from "@turf/turf";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import type { Hazard } from "./model";
self.onmessage = (e: MessageEvent<Hazard[]>) => {
  const counts: Record<string, Record<string, number>> = {
      earthquakes: {},
      fires: {},
      oil: {},
    },
    seen = new Set<string>();
  const slicks = new Map<string, Feature<Polygon | MultiPolygon>[]>();
  try {
    for (const f of e.data) {
      const p = f.properties,
        t = p.timestamp?.slice(0, 10);
      if (!t) continue;
      if (p.type === "earthquakes") {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        const m = t.slice(0, 7);
        counts.earthquakes[m] = (counts.earthquakes[m] || 0) + 1;
      }
      if (p.type === "fires" && f.geometry.type === "Point") {
        const [x, y] = f.geometry.coordinates,
          country = p.country || "Unknown";
        // Cylindrical equal-area coordinates, standard parallel 24°N.
        const c = Math.cos((24 * Math.PI) / 180),
          i = Math.floor(((6371 * x * Math.PI) / 180) * c),
          j = Math.floor((6371 * Math.sin((y * Math.PI) / 180)) / c);
        const key = [t, country, i, j].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        counts.fires[country] = (counts.fires[country] || 0) + 1;
      }
      if (
        p.type === "oil" &&
        (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")
      ) {
        const year = t.slice(0, 4),
          group = slicks.get(year) || [];
        group.push(f as Feature<Polygon | MultiPolygon>);
        slicks.set(year, group);
      }
    }
    for (const [year, group] of slicks) {
      let polys = group;
      // Batch dissolves to bound intermediate intersection work.
      while (polys.length > 1) {
        const next = [];
        for (let i = 0; i < polys.length; i += 12) {
          const batch = polys.slice(i, i + 12),
            g = batch.length === 1 ? batch[0] : union(featureCollection(batch));
          if (g) next.push(g);
        }
        polys = next;
      }
      counts.oil[year] = polys.length ? area(polys[0]) / 1e6 : 0;
    }
    self.postMessage({ counts });
  } catch {
    self.postMessage({ error: true });
  }
};
