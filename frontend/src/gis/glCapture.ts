import type { Map } from "maplibre-gl";
export async function captureGl(
  map: Map,
  labels: HTMLCanvasElement,
  second: Map | null,
  percent: number,
) {
  const canvas = document.createElement("canvas"),
    source = map.getCanvas();
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(source, 0, 0);
  const dense = map
    .getContainer()
    .querySelector<HTMLCanvasElement>("#firms-detail-canvas");
  if (dense && dense.width && dense.height)
    ctx.drawImage(dense, 0, 0, canvas.width, canvas.height);
  if (second) {
    ctx.save();
    const x = (percent / 100) * canvas.width;
    ctx.beginPath();
    ctx.rect(x, 0, canvas.width - x, canvas.height);
    ctx.clip();
    ctx.drawImage(second.getCanvas(), 0, 0, canvas.width, canvas.height);
    ctx.restore();
  }
  ctx.drawImage(labels, 0, 0, canvas.width, canvas.height);
  return canvas;
}
