import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
maplibregl.setWorkerUrl(workerUrl);
import type { Map as GLMap, GeoJSONSource } from "maplibre-gl";
import { centroid, bbox, area, length } from "@turf/turf";
import type { Position } from "geojson";
import { baseStyle, drawLabels, loadMapLabels, empty } from "./cartography";
import {
  useStore,
  byId,
  collection,
  initialSetting,
  fmt,
  type Hazard,
  type AOI,
  type ImageLayer,
} from "../model";
import type { RendererProps as Props } from "./mapApi";
import { sketchGeometry } from "./sketch";
import { captureGl } from "./glCapture";
import { CompareControls, type TileStatus } from "../CompareControls";
export function zoomHome(map: GLMap, feed: boolean, duration = 600, [west,south,east,north] = [32,12,60,33]) {
  const w = map.getContainer().clientWidth,
    h = map.getContainer().clientHeight;
  const rtl = useStore.getState().lang === "ar",
    tools = w > 700 ? 78 : 24,
    side = w > 900 && feed ? Math.min(350, w * 0.26) : 24;
  map.fitBounds(
    [
      [west, south],
      [east, north],
    ],
    {
      padding: {
        left: rtl ? side : tools,
        right: rtl ? tools : side,
        top: h > 440 ? 77 : 25,
        bottom: h > 500 ? 145 : 64,
      },
      duration,
    },
  );
}
function setImage(
  map: GLMap,
  id: string,
  image: ImageLayer | null,
  before?: string,
) {
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
  if (!image) return;
  if(image.overlay && image.bounds){
    const [w,s,e,n]=image.bounds;map.addSource(id,{type:"image",url:image.overlay,coordinates:[[w,n],[e,n],[e,s],[w,s]]});
  }else map.addSource(id, {
    type: "raster",
    tiles: image.tiles,
    ...(image.bounds?.length === 4
      ? { bounds: image.bounds as [number, number, number, number] }
      : {}),
    tileSize: 256,
    maxzoom: image.nativeZoom ?? 18,
  });
  map.addLayer(
    { id, type: "raster", source: id, paint: { "raster-fade-duration": 120 } },
    before,
  );
}
export function focusFeature(map: GLMap, f: Hazard) {
  const b = bbox(f);
  if (f.geometry.type === "Point")
    map.easeTo({
      center: f.geometry.coordinates.slice(0, 2) as [number, number],
      zoom: Math.max(6.4, map.getZoom()),
      duration: 500,
    });
  else
    map.fitBounds(b as [number, number, number, number], {
      padding: 100,
      maxZoom: 10,
      duration: 500,
    });
}

function watchTiles(
  map: GLMap,
  source: string,
  report: (status: TileStatus) => void,
) {
  let errors = false,
    loaded = false;
  report("loading");
  const progress = map.on("sourcedataloading", (e) => {
    if (e.sourceId === source) report("loading");
  });
  const data = map.on("sourcedata", (e) => {
    if (e.sourceId !== source) return;
    if (e.tile?.state === "loaded") loaded = true;
    if (e.isSourceLoaded && e.sourceDataType !== "metadata")
      report(errors ? (loaded ? "partial" : "unavailable") : "loaded");
  });
  const error = map.on("error", (e) => {
    if ("sourceId" in e && e.sourceId === source) {
      errors = true;
      report(loaded ? "partial" : "unavailable");
    }
  });
  const move = map.on("movestart", () => {
    errors = false;
    loaded = false;
  });
  return () =>
    [progress, data, error, move].forEach((sub) => sub.unsubscribe());
}
export function GlMapView(props: Props) {
  const container = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    second = useRef<HTMLDivElement>(null);
  const ref = useRef<GLMap | null>(null),
    map2 = useRef<GLMap | null>(null),
    live = useRef(props),
    points = useRef<Position[]>([]),
    finish = useRef<() => void>(() => {});
  live.current = props;
  const [generation, ready] = useState(0);
  const fraction = useRef(50);
  const [secondary, setSecondary] = useState<GLMap | null>(null);
  const [left, setLeft] = useState<TileStatus>("loading");
  const [right, setRight] = useState<TileStatus>("loading");
  const {
    base,
    profile,
    dark,
    lang,
    active,
    settings,
    mode,
    imagery,
    compareHazards,
    aoi,
    sketch,
  } = useStore();
  const current = useRef({ lang, dark, base, imagery, mode });
  current.current = { lang, dark, base, imagery, mode };
  useEffect(() => {
    if (!container.current) return;
    let map: GLMap;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: baseStyle(dark, base,profile==="research"),
        center: [46, 23],
        zoom: 4.4,
        attributionControl: false,
        canvasContextAttributes: { preserveDrawingBuffer: true },
        maxPitch: 0,
        dragRotate: false,
        touchPitch: false,
        renderWorldCopies: false,
        minZoom: 2.8,
        maxZoom: 20,
      });
    } catch {
      useStore.getState().patch({ base: "light" });
      live.current.onError(
        useStore.getState().lang === "ar"
          ? "تعذّر عرض خريطة الشوارع المتجهة. تم فتح الخريطة الفاتحة."
          : "Vector streets unavailable. Showing the light basemap.",
      );
      return;
    }
    ref.current = map;
    map.on("webglcontextlost", () =>
      useStore.getState().patch({ base: "light" }),
    );
    map.touchZoomRotate.disableRotation();
    zoomHome(map, useStore.getState().feed, 0);
    map.on("moveend", () =>
      live.current.onCameraChange?.({
        center: map.getCenter().toArray(),
        zoom: map.getZoom(),
      }),
    );
    const scale = new maplibregl.ScaleControl({
      maxWidth: 100,
      unit: "metric",
    });
    map.addControl(scale, "bottom-right");
    map.on("style.load", () => ready((x) => x + 1));
    map.on("error", (e) => {
      console.warn("Map resource:", e.error?.message);
      if (
        (e as any).sourceId === "tiles" ||
        (e as any).sourceId === "imagery" ||
        /tile|gibs|sentinel/i.test(e.error?.message || "")
      )
        live.current.onError(
          "Some map tiles are unavailable. Check the provider or select another date.",
        );
    });
    let cached: Awaited<ReturnType<typeof loadMapLabels>> | null = null,
      alive = true;
    let labelView = "";
    function labels() {
      if (!cached || !canvas.current || !alive) return;
      const s = current.current;
      const view = [
        map.getCenter().toArray(),
        map.getZoom(),
        map.getCanvas().width,
        map.getCanvas().height,
        s.lang,
        s.dark,
        s.base,
        s.imagery?.id,
        s.mode,
      ].join("|");
      if (labelView === view) return;
      labelView = view;
      drawLabels(
        map,
        canvas.current,
        cached,
        s.lang === "ar",
        s.dark || s.base === "dark",
        !!s.imagery || s.base === "satellite" || s.mode === "compare",
      );
    }
    loadMapLabels()
      .then((v) => {
        cached = v;
        labels();
      })
      .catch(() => live.current.onError("Regional map labels unavailable."));
    map.on("render", labels);
    map.on("mousemove", (e) =>
      live.current.onCoord(e.lngLat.lng, e.lngLat.lat),
    );
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container.current);
    map.on("click", async (e) => {
      const state = useStore.getState(),
        mode = state.sketch;
      if (mode) {
        points.current.push(e.lngLat.toArray());
        if (
          ["circle", "rectangle"].includes(mode) &&
          points.current.length === 2
        ) {
          finish.current();
          return;
        }
        const geom = sketchGeometry(mode, points.current, false);
        if (geom)
          (map.getSource("sketch") as GeoJSONSource)?.setData({
            type: "Feature",
            geometry: geom,
            properties: {},
          });
        live.current.onMeasure(
          points.current.length +
            " " +
            (state.lang === "ar" ? "رؤوس" : "vertices"),
        );
        return;
      }
      if (state.mode === "compare" && !state.compareHazards) return;
      const found = map
        .queryRenderedFeatures(e.point)
        .find((f) => f.layer.id.startsWith("hz-"));
      if (!found) return;
      if (found.properties.cluster) {
        const z = await (
          map.getSource(found.source) as GeoJSONSource
        ).getClusterExpansionZoom(found.properties.cluster_id);
        map.easeTo({
          center: (found.geometry as any).coordinates,
          zoom: z + 0.1,
        });
        return;
      }
      const id = found.properties.id,
        f = live.current.groups[found.properties.type]?.find(
          (f) => f.properties.id === id,
        );
      if (f) state.patch({ selected: f });
    });
    map.on("mousemove", (e) => {
      const mode = useStore.getState().sketch;
      map.getCanvas().style.cursor = mode ? "crosshair" : "";
      if (!mode || !points.current.length) return;
      const geom = sketchGeometry(
        mode,
        [...points.current, e.lngLat.toArray()],
        false,
      );
      if (geom)
        (map.getSource("sketch") as GeoJSONSource)?.setData({
          type: "Feature",
          geometry: geom,
          properties: {},
        });
    });
    finish.current = () => {
      const st = useStore.getState(),
        mode = st.sketch;
      if (!mode) return;
      const geom = sketchGeometry(mode, points.current, true);
      if (!geom || geom.type === "Point") {
        live.current.onMeasure(
          st.lang === "ar"
            ? "أضف المزيد من الرؤوس"
            : "Add more vertices to finish.",
        );
        return;
      }
      const f = { type: "Feature" as const, properties: {}, geometry: geom };
      if (geom.type === "Polygon" && mode !== "area")
        st.patch({ aoi: f as AOI, sketch: null });
      else {
        live.current.onMeasure(
          geom.type === "Polygon"
            ? fmt(area(f) / 1e6) + " km²"
            : fmt(length(f as any)) + " km",
        );
        st.patch({ sketch: null });
      }
    };
    live.current.onReady({
      map,
      home: () => zoomHome(map, useStore.getState().feed),
      fitArea: bounds => zoomHome(map,useStore.getState().feed,400,bounds),
      finish: () => finish.current(),
      focus: (f) => focusFeature(map, f),
      clearDrawing: () => {
        points.current = [];
        (map.getSource("sketch") as GeoJSONSource)?.setData(empty);
      },
      capture: () =>
        captureGl(map, canvas.current!, map2.current, fraction.current),
      showRisk: (data) => {
        if (!map.getLayer("land")) return () => {};
        map.addSource("risk-grid", { type: "geojson", data });
        map.addLayer({
          id: "risk-grid",
          type: "fill",
          source: "risk-grid",
          paint: {
            "fill-color": [
              "interpolate",
              ["linear"],
              ["get", "score"],
              0,
              "#b1d4bd",
              50,
              "#e4ad68",
              100,
              "#b9473c",
            ],
            "fill-opacity": 0.5,
          },
        });
        return () => {
          if (map.getLayer("risk-grid")) map.removeLayer("risk-grid");
          if (map.getSource("risk-grid")) map.removeSource("risk-grid");
        };
      },
    });
    return () => {
      alive = false;
      observer.disconnect();
      map.remove();
      ref.current = null;
    };
  }, []);
  const styleKey = useRef(base + "|" + dark+"|"+profile);
  useEffect(() => {
    const key = base + "|" + dark+"|"+profile;
    if (ref.current && styleKey.current !== key) {
      styleKey.current = key;
      ref.current.setStyle(baseStyle(dark, base,profile==="research"));
    }
  }, [base, dark,profile]);
  useEffect(() => {
    ref.current?.triggerRepaint();
  }, [lang, mode, imagery]);
  useEffect(() => {
    if (!ref.current || generation === 0) return;
    for (const map of [
      ref.current,
      secondary === map2.current ? secondary : null,
    ]) {
      if (!map) continue;
      for (const layer of active) {
        const def = byId[layer],
          data = collection(props.groups[layer] || []),
          id = "src-" + layer,
          opacity = (settings[layer] || initialSetting).opacity;
        if (layer === "oil") {
          const points = data.features.map((f) => ({
            ...centroid(f),
            id: String(f.id) + "-locator",
            properties: { ...f.properties, regional_marker: true },
          }));
          data.features.push(...points);
        }
        const existing = map.getSource(id) as GeoJSONSource;
        if (existing) existing.setData(data);
        else {
          const clustered = [
            "fires",
            "earthquakes",
            "volcanoes",
            "air",
            "marine",
          ].includes(layer);
          map.addSource(id, {
            type: "geojson",
            data,
            cluster: clustered,
            clusterMaxZoom: layer === "fires" ? 8 : 4,
            clusterRadius: layer === "fires" ? 44 : 22,
          });
          if (clustered) {
            map.addLayer({
              id: "hz-" + layer + "-clusters",
              source: id,
              type: "circle",
              filter: ["has", "point_count"],
              paint: {
                "circle-color": def.color,
                "circle-opacity": 0.86,
                "circle-stroke-color": "#fff9ee",
                "circle-stroke-width": 1.4,
                "circle-radius": [
                  "step",
                  ["get", "point_count"],
                  8,
                  10,
                  10,
                  75,
                  12.5,
                  500,
                  15,
                ],
              },
            });
            map.addLayer({
              id: "hz-" + layer + "-count",
              source: id,
              type: "symbol",
              filter: ["has", "point_count"],
              layout: {
                "text-field": ["get", "point_count_abbreviated"],
                "text-font": ["Noto Sans Regular"],
                "text-size": 10,
                "text-allow-overlap": true,
              },
              paint: { "text-color": "#ffffff" },
            });
          }
          const ordinary = [
            "all",
            ["!", ["has", "point_count"]],
            ["==", ["geometry-type"], "Point"],
          ] as any;
          map.addLayer({
            id: "hz-" + layer + "-fill",
            type: "fill",
            source: id,
            filter: ["==", ["geometry-type"], "Polygon"],
            paint: {
              "fill-color":
                layer === "seismic"
                  ? [
                      "interpolate",
                      ["linear"],
                      ["coalesce", ["get", "severity"], 0],
                      0,
                      "#f8dc83",
                      0.15,
                      "#ef944e",
                      0.35,
                      "#ad353e",
                      0.6,
                      "#582740",
                    ]
                  : layer === "oil"
                    ? [
                        "interpolate",
                        ["linear"],
                        ["coalesce", ["get", "confidence"], 0],
                        0,
                        "#9c8ba5",
                        1,
                        "#443053",
                      ]
                    : def.color,
              "fill-opacity": opacity * 0.55,
            },
          });
          map.addLayer({
            id: "hz-" + layer + "-line",
            type: "line",
            source: id,
            filter: ["!=", ["geometry-type"], "Point"],
            paint: {
              "line-color": layer === "oil" ? "#6a578d" : def.color,
              "line-width": layer === "oil" ? 2 : 1,
              "line-opacity": opacity,
            },
          });
          map.addLayer({
            id: "hz-" + layer + "-dot",
            type: "circle",
            source: id,
            filter: ordinary,
            paint: {
              "circle-color":
                layer === "earthquakes"
                  ? [
                      "step",
                      ["coalesce", ["get", "depth"], 0],
                      "#e9a645",
                      35,
                      "#dd7439",
                      70,
                      "#ac433c",
                      200,
                      "#873d58",
                    ]
                  : layer === "fires"
                    ? [
                        "step",
                        ["coalesce", ["get", "severity"], 0],
                        "#e09141",
                        5,
                        "#d95c34",
                        30,
                        "#b3382c",
                      ]
                    : def.color,
              "circle-radius":
                layer === "earthquakes"
                  ? [
                      "interpolate",
                      ["linear"],
                      ["coalesce", ["get", "severity"], 0],
                      0,
                      3,
                      4,
                      6,
                      7,
                      13,
                    ]
                  : 4,
              "circle-stroke-color": "#fff8f0",
              "circle-stroke-width": 1.1,
              "circle-opacity": opacity,
            },
          });
          if (layer === "flights") {
            if (!map.hasImage("plane")) {
              const c = document.createElement("canvas");
              c.width = c.height = 32;
              const ctx = c.getContext("2d")!;
              const shape = new Path2D(
                "M16 1 Q18 2 18 5 L18 12 L29 20 L29 23 L18 19 L18 26 L22 29 L22 31 L16 29 L10 31 L10 29 L14 26 L14 19 L3 23 L3 20 L14 12 L14 5 Q14 2 16 1 Z",
              );
              ctx.fillStyle = "#455f75";
              ctx.fill(shape);
              ctx.strokeStyle = "white";
              ctx.lineWidth = 1.2;
              ctx.stroke(shape);
              map.addImage("plane", ctx.getImageData(0, 0, 32, 32));
            }
            map.addLayer({
              id: "hz-flights-heading",
              type: "symbol",
              source: id,
              filter: ["!=", ["get", "mean_heading"], null],
              layout: {
                "icon-image": "plane",
                "icon-size": 0.7,
                "icon-rotate": ["get", "mean_heading"],
                "icon-allow-overlap": true,
              },
            });
          }
          if (layer === "oil") map.setLayerZoomRange("hz-oil-dot", 0, 7);
          if (layer === "earthquakes")
            map.addLayer({
              id: "hz-earthquakes-recent",
              type: "circle",
              source: id,
              filter: [
                "all",
                ["!", ["has", "point_count"]],
                [
                  ">=",
                  ["get", "timestamp"],
                  new Date(Date.now() - 864e5).toISOString(),
                ],
              ],
              paint: {
                "circle-radius": 11,
                "circle-opacity": 0,
                "circle-stroke-color": def.color,
                "circle-stroke-width": 2,
                "circle-stroke-opacity": 0.7,
              },
            });
          if (["infrastructure", "vessels", "flaring"].includes(layer)) {
            const top =
              { infrastructure: 12, vessels: 100, flaring: 2 }[layer] || 1;
            map.setPaintProperty("hz-" + layer + "-fill", "fill-color", [
              "interpolate",
              ["linear"],
              ["coalesce", ["get", "severity"], 0],
              0,
              "#e3e8db",
              top,
              def.color,
            ]);
          }
          if (layer === "volcanoes")
            map.addLayer({
              id: "hz-volcanoes-triangle",
              type: "symbol",
              source: id,
              filter: ordinary,
              layout: {
                "text-field": "▲",
                "text-font": ["Noto Sans Regular"],
                "text-size": 15,
                "text-allow-overlap": true,
              },
              paint: { "text-color": def.color },
            });
        }
        for (const l of map
          .getStyle()
          .layers.filter((l) => l.id.startsWith("hz-" + layer + "-"))) {
          map.setLayoutProperty(
            l.id,
            "visibility",
            mode === "compare" && !compareHazards ? "none" : "visible",
          );
          if (l.type === "fill")
            map.setPaintProperty(l.id, "fill-opacity", opacity * 0.55);
          if (l.type === "circle" && !l.id.endsWith("recent"))
            map.setPaintProperty(l.id, "circle-opacity", opacity);
          if (l.type === "line")
            map.setPaintProperty(l.id, "line-opacity", opacity);
          if (l.type === "symbol")
            map.setPaintProperty(l.id, "text-opacity", opacity);
        }
      }
      for (const l of map
        .getStyle()
        .layers.filter(
          (l) => l.id.startsWith("hz-") && !active.includes(l.id.split("-")[1]),
        ))
        map.setLayoutProperty(l.id, "visibility", "none");
      if (!map.getSource("sketch")) {
        map.addSource("sketch", { type: "geojson", data: empty });
        map.addLayer({
          id: "draw-fill",
          type: "fill",
          source: "sketch",
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: { "fill-color": "#3b9d91", "fill-opacity": 0.12 },
        });
        map.addLayer({
          id: "draw-line",
          type: "line",
          source: "sketch",
          paint: {
            "line-color": "#247c75",
            "line-width": 2,
            "line-dasharray": [3, 2],
          },
        });
      }
    }
  }, [
    generation,
    props.groups,
    active,
    settings,
    mode,
    compareHazards,
    secondary,
  ]);
  const compare = mode === "compare";
  useEffect(() => {
    if (!generation) return;
    for (const map of [ref.current, secondary === map2.current ? secondary : null]) {
      if (!map) continue;
      const source = map.getSource("selected-places") as GeoJSONSource | undefined;
      if (source) { source.setData(props.placeAreas); continue; }
      if (!props.placeAreas.features.length) continue;
      map.addSource("selected-places",{type:"geojson",data:props.placeAreas});
      const before = map.getStyle().layers.find(l=>l.id.startsWith("hz-")||l.id==="draw-fill")?.id;
      map.addLayer({id:"place-fill",type:"fill",source:"selected-places",paint:{"fill-color":"#2db6a4","fill-opacity":0.055}},before);
      map.addLayer({id:"place-line",type:"line",source:"selected-places",paint:{"line-color":"#137d73","line-width":2,"line-dasharray":[3,2]}},before);
    }
  }, [generation,secondary,props.placeAreas]);
  const primaryImage = compare ? props.compareImages[0].image : imagery;
  useEffect(() => {
    const map = ref.current;
    if (!map || !generation) return;
    const detach =
      compare && primaryImage ? watchTiles(map, "imagery", setLeft) : undefined;
    setImage(
      map,
      "imagery",
      primaryImage,
      map
        .getStyle()
        .layers.find((l) => l.id === "place-fill" || l.id.startsWith("hz-") || l.id === "draw-fill")?.id,
    );
    return detach;
  }, [primaryImage, compare, generation]);
  useEffect(() => {
    const map = ref.current;
    if (!map || !generation) return;
    const src = map.getSource("sketch") as GeoJSONSource;
    if (sketch) {
      points.current = [];
      src?.setData(empty);
    } else if (aoi) src?.setData(aoi);
    else if (!points.current.length) src?.setData(empty);
  }, [sketch, aoi, generation]);
  useEffect(() => {
    const m = ref.current;
    if (!m || !compare || !second.current) return;
    let s: GLMap;
    try {
      s = new maplibregl.Map({
        container: second.current,
        style: baseStyle(dark, base,profile==="research"),
        center: m.getCenter(),
        zoom: m.getZoom(),
        bearing: m.getBearing(),
        renderWorldCopies: false,
        trackResize: false,
        interactive: false,
        attributionControl: false,
        canvasContextAttributes: { preserveDrawingBuffer: true },
      });
    } catch {
      useStore.getState().patch({ base: "light" });
      return;
    }
    map2.current = s;
    setRight("loading");
    s.on("style.load", () => setSecondary(s));
    s.on("webglcontextlost", () =>
      useStore.getState().patch({ base: "light" }),
    );
    const sync = () => {
      s.jumpTo({
        center: m.getCenter(),
        zoom: m.getZoom(),
        bearing: m.getBearing(),
        padding: m.getPadding(),
      });
    };
    sync();
    const resize = () => {
      s.resize();
      sync();
    };
    m.on("move", sync);
    m.on("resize", resize);
    return () => {
      m.off("move", sync);
      m.off("resize", resize);
      s.remove();
      map2.current = null;
      setSecondary(null);
    };
  }, [compare, base, dark,profile]);
  const rightImage = props.compareImages[1].image;
  useEffect(() => {
    if (!compare || !secondary || secondary !== map2.current) return;
    const detach = rightImage
      ? watchTiles(secondary, "comparison", setRight)
      : undefined;
    setImage(
      secondary,
      "comparison",
      rightImage,
      secondary
        .getStyle()
        .layers.find((l) => l.id === "place-fill" || l.id.startsWith("hz-") || l.id === "draw-fill")?.id,
    );
    return detach;
  }, [compare, secondary, rightImage]);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const recent = props.groups.earthquakes?.some(
      (f) =>
        f.properties.timestamp &&
        Date.parse(f.properties.timestamp) >= Date.now() - 864e5,
    );
    if (!recent || mode === "compare") return;
    let tick = 0;
    const t = setInterval(() => {
      const m = ref.current;
      if (m?.getLayer("hz-earthquakes-recent")) {
        tick = (tick + 1) % 12;
        m.setPaintProperty(
          "hz-earthquakes-recent",
          "circle-radius",
          8 + tick * 0.55,
        );
        m.setPaintProperty(
          "hz-earthquakes-recent",
          "circle-stroke-opacity",
          0.8 - tick * 0.06,
        );
      }
    }, 180);
    return () => clearInterval(t);
  }, [props.groups.earthquakes, mode]);
  useEffect(() => {
    const map = ref.current,
      rows = props.groups.fires || [];
    if (
      !map ||
      !generation ||
      mode === "compare" ||
      rows.length < 5000 ||
      !map.getLayer("hz-fires-dot")
    )
      return;
    let closed = false,
      detach: (() => void) | undefined;
    import("./denseFires")
      .then(({ attachDenseFires }) => {
        if (!closed)
          detach = attachDenseFires(
            map,
            rows,
            settings.fires?.opacity ?? 0.9,
            (f) => useStore.getState().patch({ selected: f }),
          );
      })
      .catch(() => {
        if (map.getLayer("hz-fires-dot"))
          map.setLayerZoomRange("hz-fires-dot", 0, 24);
      });
    return () => {
      closed = true;
      detach?.();
    };
  }, [generation, props.groups.fires, settings.fires, mode]);
  return (
    <>
      <div className="map-surface" ref={container} />
      {mode === "compare" && (
        <>
          <div
            ref={second}
            className="compare-map"
            style={{ clipPath: "inset(0 0 0 " + fraction.current + "%)" }}
          />
          <CompareControls
            images={props.compareImages}
            onZoomArea={([w,s,e,n])=>ref.current?.fitBounds([[w,s],[e,n]],{padding:20,duration:0})}
            initial={fraction.current}
            status={[left, right]}
            onSplit={(percent) => {
              fraction.current = percent;
              if (second.current)
                second.current.style.clipPath = `inset(0 0 0 ${percent}%)`;
            }}
          />
        </>
      )}
      <canvas aria-hidden="true" className="map-labels" ref={canvas} />
    </>
  );
}
