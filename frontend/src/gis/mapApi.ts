import type { FeatureCollection } from "geojson";
import type { Hazard } from "../model";
import type { Bounds, PlaceFilterState } from "./placeFilter";

export type CameraView = { center: [number, number]; zoom: number };
export type MapApi = {
  map: {
    getCenter(): { lng: number; lat: number; toArray(): [number, number] };
    getZoom(): number;
    getBounds(): {
      getNorth(): number;
      getSouth(): number;
      getWest(): number;
      getEast(): number;
    };
    getContainer(): HTMLElement;
    zoomIn(): void;
    zoomOut(): void;
    flyTo(view: CameraView): void;
  };
  focus: (feature: Hazard) => void;
  home: () => void;
  fitArea: (bounds: Bounds) => void;
  finish: () => void;
  clearDrawing: () => void;
  showRisk: (data: FeatureCollection) => () => void;
  capture: () => Promise<HTMLCanvasElement>;
};
export type Props = {
  placeAreas: PlaceFilterState["areas"];
  groups: Record<string, Hazard[]>;
  onReady: (m: MapApi) => void;
  onCameraChange?: (camera: CameraView) => void;
  onCoord: (x: number, y: number) => void;
  onMeasure: (v: string) => void;
  onError: (v: string) => void;
};
export type RendererProps = Props & {
  compareImages: import("../compareImagery").ComparePair;
};
