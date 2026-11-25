import { MapboxOverlay } from "@deck.gl/mapbox";
import { ScatterplotLayer } from "@deck.gl/layers";
import type { Map as GLMap } from "maplibre-gl";
import type { Hazard } from "../model";

// Keep the clustered overview. GPU-render individual pixels once clusters dissolve.
export function attachDenseFires(
  map: GLMap,
  records: Hazard[],
  opacity: number,
  select: (f: Hazard) => void,
) {
  const points = records.filter((f) => f.geometry.type === "Point");
  const overlay = new MapboxOverlay({
    interleaved: false,
    id: "firms-detail-canvas",
    deviceProps: { webgl: { preserveDrawingBuffer: true } },
    layers: [],
  });
  const original = "hz-fires-dot";
  let added = false;
  const render = (on: boolean) => {
    if (!added) return;
    overlay.setProps({
      layers: on
        ? [
            new ScatterplotLayer<Hazard>({
              id: "high-resolution-firms",
              data: points,
              pickable: true,
              radiusUnits: "pixels",
              getRadius: 4,
              getPosition: (f) =>
                (f.geometry as GeoJSON.Point).coordinates.slice(0, 2) as [
                  number,
                  number,
                ],
              getFillColor: (f) =>
                (f.properties.severity || 0) > 30
                  ? [179, 56, 44]
                  : (f.properties.severity || 0) > 5
                    ? [217, 92, 52]
                    : [224, 145, 65],
              opacity,
              stroked: true,
              getLineColor: [255, 248, 240],
              lineWidthUnits: "pixels",
              getLineWidth: 0.8,
              onClick: (info) => {
                if (info.object) select(info.object);
              },
            }),
          ]
        : [],
    });
  };
  const update = () => render(map.getZoom() >= 9);
  map.addControl(overlay);
  added = true;
  if (map.getLayer(original)) map.setLayerZoomRange(original, 0, 9);
  map.on("zoomend", update);
  update();
  return () => {
    added = false;
    map.off("zoomend", update);
    if (map.hasControl(overlay)) map.removeControl(overlay);
    if (map.getLayer(original)) map.setLayerZoomRange(original, 0, 24);
  };
}
