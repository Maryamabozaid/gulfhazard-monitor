import { lazy, Suspense, useRef, useState } from "react";
import { useAutoImagery } from "../autoImagery";
import { useCompareImages } from "../compareImagery";
import { useStore } from "../model";
import { RegionalMap } from "./RegionalMap";
import type { CameraView, MapApi, Props } from "./mapApi";
export type { MapApi } from "./mapApi";
const VectorMap = lazy(() =>
  import("./GlMapView").then((module) => ({ default: module.GlMapView })),
);

export function MapView(props: Props) {
  const vector = useStore((s) => s.base === "vector");
  const camera = useRef<CameraView | null>(null);
  const [focus, setFocus] = useState<CameraView | null>(null);
  useAutoImagery(focus);
  const compareImages = useCompareImages(focus);
  const bindings = {
    ...props,
    compareImages,
    onCameraChange: (view: CameraView) => {
      camera.current = view;
      setFocus(view);
    },
    onReady: (api: MapApi) => {
      if (camera.current) api.map.flyTo(camera.current);
      setFocus({
        center: api.map.getCenter().toArray(),
        zoom: api.map.getZoom(),
      });
      props.onReady(api);
    },
  };
  return vector ? (
    <Suspense fallback={null}>
      <VectorMap {...bindings} />
    </Suspense>
  ) : (
    <RegionalMap {...bindings} />
  );
}
