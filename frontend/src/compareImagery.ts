import { useEffect, useState } from "react";
import { raster } from "./imagery";
import { useStore, type ImageLayer } from "./model";
import type { CameraView } from "./gis/mapApi";

export const compareOptions = [
  ["daily", "MODIS + VIIRS"],
  ["mosaic", "MODIS · Terra + Aqua"],
  ["true", "MODIS · Terra"],
  ["aqua", "MODIS · Aqua"],
  ["noaa20", "VIIRS · NOAA-20"],
  ["viirs", "VIIRS · Suomi NPP"],
  ["optical", "Sentinel-2 · RGB"],
  ["landsat", "Landsat 8/9 · RGB"],
  ["s1", "Sentinel-1 · SAR"],
  ["water", "Sentinel-1 · Water mask"],
  ["change", "Sentinel-1 · Change (A → B)"],
];
export type Selection = {
  image: ImageLayer | null;
  message?: string;
  latest?: string;
};
export type ComparePair = [Selection, Selection];
const searching: Selection = { image: null, message: "searching" };
export const isScene = (id: string) =>
  ["optical", "landsat", "s1", "water", "change"].includes(id);
export const providerFor = (id: string) =>
  isScene(id) ? "Planetary Computer" : "NASA GIBS";

function useSide(index: number, camera: CameraView | null): Selection {
  const enabled = useStore((s) => s.mode === "compare");
  const date = useStore((s) => s.compareDates[index]);
  const product = useStore((s) => s.compareProducts[index]);
  const before = useStore((s) =>
    product === "change" ? s.compareDates[0] : "",
  );
  const lon = isScene(product) ? camera?.center[0].toFixed(4) : "";
  const lat = isScene(product) ? camera?.center[1].toFixed(4) : "";
  const key = [product, date, before, lon, lat].join("|");
  const [result, setResult] = useState<{
    key: string;
    value: Selection;
  } | null>(null);
  useEffect(() => {
    if (!enabled || lon === undefined || lat === undefined) {
      setResult(null);
      return;
    }
    const ctrl = new AbortController();
    const signal = ctrl.signal;
    async function resolve(): Promise<Selection> {
      if (product === "water" || product === "change") {
        const r = await fetch(
          "/api/radar?" +
            new URLSearchParams({
              mode: product,
              date,
              before,
              lon: lon!,
              lat: lat!,
            }),
          { signal },
        );
        const data = await r.json();
        return r.ok
          ? { image: data }
          : { image: null, message: data.code || "provider" };
      }
      if (isScene(product)) {
        const collection =
          product === "s1"
            ? "sentinel-1-grd"
            : product === "optical"
              ? "sentinel-2-l2a"
              : "landsat-c2-l2";
        const qs = new URLSearchParams({
          date,
          lon: lon!,
          lat: lat!,
          lookback: "7",
          collection,
        });
        const res = await fetch("/api/scene?" + qs, { signal });
        const info = await res.json();
        if (!res.ok) return { image: null, message: info.code || "provider" };
        return {
          image: {
            id: info.id,
            name: info.platform.toUpperCase(),
            date: info.time,
            product,
            requestedDate: date,
            attribution: info.source,
            tiles: info.tiles,
            bounds: info.bounds,
            nativeZoom: info.nativeZoom,
            resolutionLabel: info.resolution
              ? info.resolution + " m"
              : undefined,
            url: info.url,
            metadataRetrievedAt: info.metadataRetrievedAt,
            metadataStatus: info.metadataStatus,
          },
        };
      }
      const res = await fetch(
        "/api/imagery/dates?" + new URLSearchParams({ product, date }),
        { signal },
      );
      const info = await res.json();
      if (!res.ok) return { image: null, message: "provider" };
      if (!info.available)
        return { image: null, message: "no_day", latest: info.latest };
      const composite = product === "mosaic" || product === "daily";
      const view =
        composite && info.sources?.length === 1 ? info.sources[0] : product;
      const image = ["daily", "mosaic", "aqua"].includes(view)
        ? {
            ...raster("true", date),
            id: view,
            product: view,
            name: compareOptions.find(([id]) => id === view)![1],
            attribution: "NASA GIBS",
            tiles: [`/api/modis/${date}/{z}/{x}/{y}.png?view=${view}`],
          }
        : raster(view, date);
      return {
        image: {
          ...image,
          metadataStatus: info.metadataStatus,
          metadataRetrievedAt: info.metadataRetrievedAt,
        },
      };
    }
    const timer = setTimeout(
      async () => {
        try {
          const value = await resolve();
          if (!signal.aborted) setResult({ key, value });
        } catch {
          if (!signal.aborted)
            setResult({ key, value: { image: null, message: "provider" } });
        }
      },
      isScene(product) ? 220 : 0,
    );
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [enabled, key, product, date, before, lon, lat]);
  return enabled && result?.key === key ? result.value : searching;
}
export function useCompareImages(camera: CameraView | null): ComparePair {
  return [useSide(0, camera), useSide(1, camera)];
}
