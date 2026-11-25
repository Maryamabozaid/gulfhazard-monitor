import {
  bbox,
  bboxPolygon,
  circle,
  distance,
  lineString,
  point,
  polygon,
} from "@turf/turf";
import type { Position, Geometry } from "geojson";
export function sketchGeometry(
  mode: string,
  ps: Position[],
  final: boolean,
): Geometry | null {
  if (!ps.length) return null;
  if (ps.length === 1) return point(ps[0]).geometry;
  if (mode === "rectangle")
    return bboxPolygon(bbox(lineString([ps[0], ps[ps.length - 1]]))).geometry;
  if (mode === "circle")
    return circle(ps[0], Math.max(0.001, distance(ps[0], ps[ps.length - 1])), {
      steps: 64,
    }).geometry;
  if (mode !== "distance" && ps.length >= 3)
    return polygon([[...ps, ps[0]]]).geometry;
  return final && mode !== "distance" ? null : lineString(ps).geometry;
}
