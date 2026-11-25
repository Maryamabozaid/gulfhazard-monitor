import { readFileSync } from "node:fs";
import { restriction } from "./licensing.mjs";
const cells = new Map(),
  step = 0.03;
if (!restriction("flaring")) {
  const { sites } = JSON.parse(
    readFileSync(new URL("../datasets/flare-filter.json", import.meta.url)),
  );
  for (const [x, y] of sites) {
    const key = [Math.floor(x / step), Math.floor(y / step)].join(",");
    const rows = cells.get(key) || [];
    rows.push([x, y]);
    cells.set(key, rows);
  }
}
export function industrialReason(x, y, type) {
  if (String(type) === "2") return "FIRMS static land source";
  const i = Math.floor(x / step),
    j = Math.floor(y / step),
    cos = Math.cos((y * Math.PI) / 180);
  for (let a = i - 1; a <= i + 1; a++)
    for (let b = j - 1; b <= j + 1; b++) {
      if (
        cells
          .get([a, b].join(","))
          ?.some(([xx, yy]) => 111 * Math.hypot((x - xx) * cos, y - yy) <= 1)
      )
        return "Within 1 km of an EOG 2025 flare site";
    }
  return null;
}
