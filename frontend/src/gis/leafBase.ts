import * as L from "leaflet";
import type { FeatureCollection } from "geojson";
import type { ImageLayer } from "../model";

export function pane(map: L.Map, name: string, zIndex: number) {
  const element = map.getPane(name) || map.createPane(name);
  element.style.zIndex = String(zIndex);
  return element;
}

const geography = new Map<string, Promise<FeatureCollection>>();
function localFile(name: string) {
  let data = geography.get(name);
  if (!data) {
    data = fetch("/cartography/" + name + ".geojson")
      .then((response) => {
        if (!response.ok) throw Error(name);
        return response.json() as Promise<FeatureCollection>;
      })
      .catch((error) => {
        geography.delete(name);
        throw error;
      });
    geography.set(name, data);
  }
  return data;
}

export function baseMap(
  map: L.Map,
  base: string,
  darkTheme: boolean,
  warn: (en: string, ar: string) => void,
  onlineDetail = true,
) {
  const dark = base === "dark" || (base === "light" && darkTheme);
  const photo = base === "satellite" || base === "terrain";
  const sea = dark ? "#223a46" : "#c4dce3";
  map.getContainer().style.backgroundColor = sea;
  const group = L.layerGroup().addTo(map);
  let alive = true;
  async function geometry(name: string, options: L.GeoJSONOptions) {
    try {
      const data = await localFile(name);
      if (alive)
        L.geoJSON(data, { ...options, interactive: false }).addTo(group);
    } catch {
      if (alive)
        warn(
          "Local geography unavailable: " + name,
          "تعذّر تحميل ملف جغرافي: " + name,
        );
    }
  }
  geometry("world", {
    pane: "land",
    style: {
      stroke: false,
      fillColor: dark ? "#343c3a" : "#f3f2eb",
      fillOpacity: 1,
    },
  });
  L.imageOverlay(
    "/cartography/relief.webp",
    [
      [0, 22.5],
      [40.97989807, 73.125],
    ],
    {
      pane: "relief",
      opacity: dark ? 0.27 : 0.6,
      interactive: false,
    },
  ).addTo(group);
  geometry("water", {
    pane: "geography",
    style: { color: sea, weight: 1, fillColor: sea, fillOpacity: 1 },
  });
  geometry("provinces", {
    pane: "geography",
    style: {
      color: dark ? "#849395" : "#b4b5ab",
      weight: 0.75,
      dashArray: "3 4",
      opacity: 0.75,
      fill: false,
    },
  });
  geometry("world", {
    pane: "borders",
    style: {
      color: dark ? "#9ea9a7" : "#999e96",
      weight: 1,
      opacity: 0.95,
      fill: false,
    },
  });

  const gray = dark ? "Canvas/World_Dark_Gray" : "Canvas/World_Light_Gray";
  const service =
    base === "satellite"
      ? "World_Imagery"
      : base === "terrain"
        ? "World_Topo_Map"
        : gray + "_Base";
  const tileUrl = (name: string) =>
    "https://server.arcgisonline.com/ArcGIS/rest/services/" +
    name +
    "/MapServer/tile/{z}/{y}/{x}";
  const options: L.TileLayerOptions = {
    pane: "basetiles",
    noWrap: true,
    crossOrigin: "anonymous",
    maxNativeZoom: 19, maxZoom: 21,
    keepBuffer: 1,
  };
  // The local geometry remains visible if the online tile service is unavailable.
  if (onlineDetail && !photo) {
    L.tileLayer(tileUrl(gray + "_Reference"), {
      ...options,
      pane: "roadnames",
      minZoom: 9,
    }).addTo(group);
  }
  let reported = false;
  if (onlineDetail) L.tileLayer(tileUrl(service), { ...options, minZoom: photo ? 0 : 7 })
    .on("tileerror", () => {
      if (alive && !reported) {
        reported = true;
        warn(
          "Some Esri tiles are unavailable. Regional geography is visible.",
          "بعض بلاطات Esri غير متاحة. الحدود الإقليمية ظاهرة.",
        );
      }
    })
    .addTo(group);
  return () => {
    alive = false;
    group.remove();
  };
}

export function imageTiles(image: ImageLayer, paneName: string) {
  const template = image.tiles[0];
  const [west, south, east, north] = image.bounds || [];
  const layer = L.tileLayer(template, {
    pane: paneName,
    crossOrigin: "anonymous",
    noWrap: true,
    maxNativeZoom: image.nativeZoom ?? 18,
    maxZoom: 21,
    bounds: image.bounds
      ? [
          [south, west],
          [north, east],
        ]
      : undefined,
  });
  if (template.includes("{bbox-epsg-3857}")) {
    layer.getTileUrl = ({ x, y, z }) => {
      const edge = 20037508.342789244,
        span = (edge * 2) / 2 ** z;
      return template.replace(
        "{bbox-epsg-3857}",
        [
          -edge + x * span,
          edge - (y + 1) * span,
          -edge + (x + 1) * span,
          edge - y * span,
        ].join(","),
      );
    };
  }
  return layer;
}
