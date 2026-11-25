import { bboxPolygon, booleanIntersects } from "@turf/turf";
import type { MapApi } from "./gis/MapView";
import { collection, type Hazard, type AOI } from "./model";
export function download(name: string, file: Blob) {
  const url = URL.createObjectURL(file),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function csv(value: unknown) {
  const text = String(value ?? "");
  return (
    '"' +
    (/^[=+@\-\t\r]/.test(text) ? "'" : "") +
    text.replaceAll('"', '""') +
    '"'
  );
}
export function visibleRecords(
  api: MapApi,
  records: Hazard[],
  aoi: AOI | null,
) {
  const b = api.map.getBounds(),
    view = bboxPolygon([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
  return records.filter(
    (f) => booleanIntersects(f, view) && (!aoi || booleanIntersects(f, aoi)),
  );
}
export async function exportFile(
  format: string,
  api: MapApi,
  records: Hazard[],
  aoi: AOI | null,
  credits: string,
) {
  const data = collection(visibleRecords(api, records, aoi)),
    prefix = "GulfHazard-" + new Date().toISOString().slice(0, 10);
  if (format === "geojson") {
    download(
      prefix + ".geojson",
      new Blob([JSON.stringify(data)], { type: "application/geo+json" }),
    );
    return;
  }
  if (format === "csv") {
    const keys = [
      "id",
      "type",
      "title",
      "timestamp",
      "severity",
      "confidence",
      "source",
      "source_url",
      "country",
      "geometry",
    ];
    const rows = data.features.map((f) =>
      keys
        .map((k) =>
          csv(
            k === "geometry" ? JSON.stringify(f.geometry) : f.properties?.[k],
          ),
        )
        .join(","),
    );
    download(
      prefix + ".csv",
      new Blob(["\uFEFF" + [keys.join(","), ...rows].join("\r\n")], {
        type: "text/csv;charset=utf-8",
      }),
    );
    return;
  }
  if (format === "shp") {
    const {shapeArchive} = await import("./shapefile");
    download(prefix + ".zip", await shapeArchive(data));
    return;
  }
  const canvas = await api.capture();
  const ctx = canvas.getContext("2d")!;
  const scale = canvas.width / api.map.getContainer().clientWidth;
  ctx.scale(scale, scale);
  ctx.font = "12px Arial";
  const h = canvas.height / scale,
    w = canvas.width / scale;
  ctx.fillStyle = "rgba(255,255,255,.94)";
  ctx.fillRect(0, h - 46, w, 46);
  ctx.fillStyle = "#263232";
  ctx.fillText("GulfHazard Monitor · " + new Date().toISOString(), 10, h - 28);
  ctx.fillText(credits, 10, h - 9, w - 20);
  if (format === "png") {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r));
    if (!blob) throw Error("Map image unavailable.");
    download(prefix + ".png", blob);
  } else {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({
      orientation: w >= h ? "landscape" : "portrait",
      unit: "px",
      format: [w, h],
      hotfixes: ["px_scaling"],
    });
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.94), "JPEG", 0, 0, w, h);
    pdf.save(prefix + ".pdf");
  }
}
