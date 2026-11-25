import type { Map } from "leaflet";

// Export the loaded map panes in display order, using their actual projected positions.
export async function captureMap(
  map: Map,
  labels: HTMLCanvasElement,
  split: number | null,
) {
  const host = map.getContainer(),
    frame = host.getBoundingClientRect();
  const canvas = document.createElement("canvas"),
    dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(frame.width * dpr);
  canvas.height = Math.round(frame.height * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = getComputedStyle(host).backgroundColor;
  ctx.fillRect(0, 0, frame.width, frame.height);
  const panes = Object.entries(map.getPanes())
    .filter(([name]) => name !== "mapPane")
    .sort(
      (a, b) =>
        Number(getComputedStyle(a[1]).zIndex) -
        Number(getComputedStyle(b[1]).zIndex),
    );
  for (const [name, pane] of panes) {
    ctx.save();
    if (split !== null && (name === "imageryA" || name === "imageryB")) {
      const x = (frame.width * split) / 100;
      ctx.beginPath();
      ctx.rect(
        name === "imageryA" ? 0 : x,
        0,
        name === "imageryA" ? x : frame.width - x,
        frame.height,
      );
      ctx.clip();
    }
    const elements = pane.querySelectorAll<
      SVGSVGElement | HTMLImageElement | HTMLElement
    >("svg, img, .hazard-symbol");
    for (const el of elements) {
      const rect = el.getBoundingClientRect(),
        x = rect.left - frame.left,
        y = rect.top - frame.top;
      if (
        !rect.width ||
        !rect.height ||
        x > frame.width ||
        y > frame.height ||
        x + rect.width < 0 ||
        y + rect.height < 0
      )
        continue;
      const css = getComputedStyle(el);
      ctx.save();
      ctx.globalAlpha = Number(css.opacity);
      if (el instanceof HTMLImageElement) {
        const tiles = el.closest(".leaflet-tile-container")?.parentElement;
        if (tiles) ctx.globalAlpha *= Number(getComputedStyle(tiles).opacity);
        if (el.complete && el.naturalWidth)
          ctx.drawImage(el, x, y, rect.width, rect.height);
      } else if (el instanceof SVGSVGElement) {
        const copy = el.cloneNode(true) as SVGSVGElement;
        copy.removeAttribute("class");
        copy.removeAttribute("style");
        copy.setAttribute("width", String(rect.width));
        copy.setAttribute("height", String(rect.height));
        const blob = new Blob([new XMLSerializer().serializeToString(copy)], {
          type: "image/svg+xml",
        });
        const url = URL.createObjectURL(blob);
        try {
          const img = new Image();
          img.src = url;
          await img.decode();
          ctx.drawImage(img, x, y, rect.width, rect.height);
        } finally {
          URL.revokeObjectURL(url);
        }
      } else {
        const badge = el.firstElementChild;
        if (badge) {
          const style = getComputedStyle(badge);
          ctx.translate(x + rect.width / 2, y + rect.height / 2);
          const cluster = el.classList.contains("cluster-symbol");
          if (cluster) {
            ctx.beginPath();
            ctx.arc(0, 0, rect.width / 2 - 1, 0, Math.PI * 2);
            ctx.fillStyle = style.backgroundColor;
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = "#fff9ef";
            ctx.stroke();
          }
          ctx.rotate(
            (parseFloat(style.getPropertyValue("--heading") || "0") * Math.PI) /
              180,
          );
          ctx.fillStyle = style.color;
          ctx.font = style.fontWeight + " " + style.fontSize + " Arial";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(badge.textContent || "", 0, 0);
        }
      }
      ctx.restore();
    }
    ctx.restore();
  }
  if (labels.width && labels.height)
    ctx.drawImage(labels, 0, 0, frame.width, frame.height);
  return canvas;
}
