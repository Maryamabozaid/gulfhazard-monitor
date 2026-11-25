import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { bbox, area, length } from "@turf/turf";
import type { Feature, Geometry, Position } from "geojson";
import { loadMapLabels, drawLabels } from "./cartography";
import { baseMap, imageTiles, pane } from "./leafBase";
import { captureMap } from "./leafCapture";
import { hazardLayer, lonLat } from "./leafHazards";
import { sketchGeometry } from "./sketch";
import { useStore, layers, initialSetting, fmt, type AOI } from "../model";
import type { RendererProps as Props } from "./mapApi";
import { CompareControls, type TileStatus } from "../CompareControls";
import type { ImageLayer } from "../model";

function useImagePane(
  map: L.Map | null,
  paneName: string,
  image: ImageLayer | null,
  compare: boolean,
  warn?: (en: string, ar: string) => void,
) {
  const [status, setStatus] = useState<TileStatus>("loading");
  useEffect(() => {
    const source = image;
    if (!map || !source) return;
    if (source.overlay && source.bounds){
      const [w,s,e,n]=source.bounds;
      const overlay=L.imageOverlay(source.overlay,[[s,w],[n,e]],{pane:paneName,interactive:false});
      setStatus("loading");overlay.on("load",()=>setStatus("loaded"));overlay.on("error",()=>setStatus("unavailable"));overlay.addTo(map);
      return ()=>{overlay.remove();overlay.off();};
    }
    const tile = imageTiles(source, paneName);
    if (!compare && warn)
      tile.once("tileerror", () =>
        warn(
          source.bounds
            ? "Some tiles are outside this scene or unavailable. The basemap shows through."
            : "Imagery tiles unavailable for this date.",
          source.bounds
            ? "بعض البلاطات خارج حدود اللقطة أو غير متاحة. تظهر خريطة الأساس مكانها."
            : "بعض صور الأقمار غير متاحة لهذا التاريخ.",
        ),
      );
    tile.on("loading", () => setStatus("loading"));
    tile.on("load", () => {
      const nodes = Array.from(
        tile
          .getContainer()
          ?.querySelectorAll<HTMLImageElement>("img.leaflet-tile") ?? [],
      );
      const loaded = nodes.filter((img) => img.complete && img.naturalWidth);
      const status = !loaded.length
        ? "unavailable"
        : loaded.length < nodes.length
          ? "partial"
          : "loaded";
      if (status !== "loaded" || !compare) return setStatus(status);
      // Sample visible tile interiors to distinguish a successful transparent
      // tile (no observation) from a network failure.
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 24;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return setStatus("loaded");
      const frame = map.getContainer().getBoundingClientRect();
      let valid = 0,
        total = 0;
      try {
        for (const img of loaded) {
          const box = img.getBoundingClientRect();
          const x = Math.max(frame.left, box.left),
            y = Math.max(frame.top, box.top);
          const w = Math.min(frame.right, box.right) - x,
            h = Math.min(frame.bottom, box.bottom) - y;
          if (w <= 0 || h <= 0) continue;
          ctx.clearRect(0, 0, 24, 24);
          ctx.drawImage(
            img,
            ((x - box.left) * img.naturalWidth) / box.width,
            ((y - box.top) * img.naturalHeight) / box.height,
            (w * img.naturalWidth) / box.width,
            (h * img.naturalHeight) / box.height,
            0,
            0,
            24,
            24,
          );
          const rgba = ctx.getImageData(0, 0, 24, 24).data;
          for (let i = 3; i < rgba.length; i += 4) {
            total++;
            if (rgba[i] > 0) valid++;
          }
        }
      } catch {
        return setStatus("loaded");
      }
      setStatus(
        valid === 0 ? "no_coverage" : valid < total ? "gaps" : "loaded",
      );
    });
    setStatus("loading");
    tile.addTo(map);
    return () => {
      tile.remove();
      tile.off();
    };
  }, [map, paneName, image, compare, warn]);
  return status;
}

function fitRegion(map: L.Map, [west,south,east,north] = [32,12,60,33]) {
  const size = map.getSize(),
    state = useStore.getState();
  const side =
    size.x > 900 && state.feed && state.mode === "explore"
      ? Math.min(350, size.x * 0.26)
      : 8;
  const tools = size.x > 850 ? 52 : 10;
  const rtl = state.lang === "ar";
  map.fitBounds(
    [
      [south, west],
      [north, east],
    ],
    {
      animate: false,
      paddingTopLeft: [rtl ? side : tools, size.y > 520 ? 40 : 12],
      paddingBottomRight: [rtl ? tools : side, size.y > 520 ? 96 : 44],
    },
  );
}

export function RegionalMap(props: Props) {
  const target = useRef<HTMLDivElement>(null),
    labels = useRef<HTMLCanvasElement>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const state = useStore();
  const live = useRef(props);
  live.current = props;
  const fraction = useRef(50);
  const warn = useCallback((en: string, ar: string) => {
    live.current.onError(useStore.getState().lang === "ar" ? ar : en);
  }, []);
  const compare = state.mode === "compare";
  const left = useImagePane(
    map,
    "imageryA",
    compare ? props.compareImages[0].image : state.imagery,
    compare,
    warn,
  );
  const right = useImagePane(
    map,
    "imageryB",
    compare ? props.compareImages[1].image : null,
    compare,
  );
  const clip = useCallback(() => {
    if (!map) return;
    // Leaflet translates its panes on pan. Express the viewport cut in the
    // pane's layer coordinates, including any accumulated translation.
    const { x, y } = map.containerPointToLayerPoint([0, 0]);
    const size = map.getSize();
    const bottom = y + size.y,
      end = x + size.x;
    const seam = x + (size.x * fraction.current) / 100;
    const fence = (a: number, b: number) =>
      `polygon(${a}px ${y}px, ${b}px ${y}px, ${b}px ${bottom}px, ${a}px ${bottom}px)`;
    map.getPane("imageryA")!.style.clipPath = fence(x, seam);
    map.getPane("imageryB")!.style.clipPath = fence(seam, end);
  }, [map]);
  useLayoutEffect(() => {
    if (!map || !compare) return;
    clip();
    map.on("move zoom resize viewreset", clip);
    return () => {
      map.off("move zoom resize viewreset", clip);
      map.getPane("imageryA")!.style.clipPath = "";
      map.getPane("imageryB")!.style.clipPath = "";
    };
  }, [map, compare, clip]);
  const vertices = useRef<Position[]>([]),
    drawing = useRef<L.GeoJSON | null>(null);
  const finish = useRef<() => void>(() => {});

  useEffect(() => {
    if (!target.current) return;
    const m = L.map(target.current, {
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: true,
      dragging: true,
      touchZoom: true,
      keyboard: true,
      zoomSnap: 0,
      zoomDelta: 1,
      minZoom: 2,
      maxZoom: 21,
      zoomAnimation: false,
      markerZoomAnimation: false,
      fadeAnimation: false,
      doubleClickZoom: true,
    });
    const basePanes: [string, number][] = [
      ["land", 200],
      ["relief", 210],
      ["basetiles", 220],
      ["geography", 225],
      ["borders", 230],
      ["roadnames", 235],
      ["imageryA", 300],
      ["imageryB", 301],
      ["places", 395],
      ["risk", 402],
      ["sketch", 580],
    ];
    basePanes.forEach(([name, z]) => pane(m, name, z));
    layers.forEach((l, i) =>
      pane(
        m,
        "hazard-" + l.id,
        l.id === "earthquakes"
          ? 552
          : l.id === "oil"
            ? 551
            : l.id === "fires"
              ? 548
              : 430 + i,
      ),
    );
    fitRegion(m);
    m.on("moveend", () => {
      const { lat, lng } = m.getCenter();
      live.current.onCameraChange?.({
        center: [lng, lat],
        zoom: m.getZoom() - 1,
      });
    });
    L.control
      .scale({ imperial: false, position: "bottomright", maxWidth: 100 })
      .addTo(m);
    drawing.current = L.geoJSON(undefined, {
      pane: "sketch",
      interactive: false,
      style: {
        color: "#247c75",
        weight: 2,
        dashArray: "5 4",
        fillOpacity: 0.14,
      },
      pointToLayer: (_, at) =>
        L.circleMarker(at, {
          pane: "sketch",
          radius: 4,
          color: "#247c75",
          interactive: false,
        }),
    }).addTo(m);
    const draw = (g: Geometry | null) => {
      drawing.current?.clearLayers();
      if (g)
        drawing.current?.addData({
          type: "Feature",
          properties: {},
          geometry: g,
        } as Feature);
    };
    finish.current = () => {
      const s = useStore.getState(),
        mode = s.sketch;
      if (!mode) return;
      const g = sketchGeometry(mode, vertices.current, true);
      if (!g || g.type === "Point") {
        live.current.onMeasure(
          s.lang === "ar"
            ? "أضف المزيد من الرؤوس"
            : "Add more vertices to finish.",
        );
        return;
      }
      draw(g);
      const f = { type: "Feature" as const, properties: {}, geometry: g };
      if (g.type === "Polygon" && mode !== "area")
        s.patch({ aoi: f as AOI, sketch: null });
      else {
        live.current.onMeasure(
          g.type === "Polygon"
            ? fmt(area(f) / 1e6) + " km²"
            : fmt(length(f as Feature<GeoJSON.LineString>)) + " km",
        );
        s.patch({ sketch: null });
      }
    };
    m.on("click", (e: L.LeafletMouseEvent) => {
      const s = useStore.getState();
      if (!s.sketch) return;
      vertices.current.push([e.latlng.lng, e.latlng.lat]);
      if (
        ["circle", "rectangle"].includes(s.sketch) &&
        vertices.current.length === 2
      )
        return finish.current();
      draw(sketchGeometry(s.sketch, vertices.current, false));
      live.current.onMeasure(
        vertices.current.length + (s.lang === "ar" ? " رؤوس" : " vertices"),
      );
    });
    m.on("mousemove", (e: L.LeafletMouseEvent) => {
      live.current.onCoord(e.latlng.lng, e.latlng.lat);
      const mode = useStore.getState().sketch;
      if (mode && vertices.current.length)
        draw(
          sketchGeometry(
            mode,
            [...vertices.current, [e.latlng.lng, e.latlng.lat]],
            false,
          ),
        );
    });
    const observer = new ResizeObserver(() => m.invalidateSize({ pan: false }));
    observer.observe(target.current);
    live.current.onReady({
      map: {
        getCenter: () => {
          const { lat, lng } = m.getCenter();
          return { lat, lng, toArray: (): [number, number] => [lng, lat] };
        },
        getZoom: () => m.getZoom() - 1,
        getBounds: () => m.getBounds(),
        getContainer: () => m.getContainer(),
        zoomIn: () => m.zoomIn(),
        zoomOut: () => m.zoomOut(),
        flyTo: ({ center, zoom }) => m.setView(lonLat(center), zoom + 1),
      },
      home: () => fitRegion(m),
      fitArea: bounds => fitRegion(m,bounds),
      finish: () => finish.current(),
      clearDrawing: () => {
        vertices.current = [];
        draw(null);
      },
      focus: (f) => {
        if (f.geometry.type === "Point")
          m.setView(lonLat(f.geometry.coordinates), Math.max(7.4, m.getZoom()));
        else {
          const [w, s, e, n] = bbox(f);
          m.fitBounds(
            [
              [s, w],
              [n, e],
            ],
            { maxZoom: 11, padding: [34, 54] },
          );
        }
      },
      capture: () =>
        captureMap(
          m,
          labels.current!,
          useStore.getState().mode === "compare" ? fraction.current : null,
        ),
      showRisk: (data) => {
        const risk = L.geoJSON(data, {
          pane: "risk",
          interactive: false,
          style: (f) => ({
            stroke: false,
            fillOpacity: 0.5,
            fillColor:
              (f?.properties?.score || 0) > 65
                ? "#b9473c"
                : (f?.properties?.score || 0) > 30
                  ? "#e4ad68"
                  : "#b1d4bd",
          }),
        }).addTo(m);
        return () => {
          risk.remove();
        };
      },
    });
    setMap(m);
    return () => {
      observer.disconnect();
      m.remove();
      drawing.current = null;
    };
  }, []);

  useEffect(() => {
    if (map) return baseMap(map, state.base, state.dark, warn,state.profile==="research");
  }, [map, state.base, state.dark,state.profile]);
  useEffect(() => {
    if (!map || !props.placeAreas.features.length) return;
    const outline = L.geoJSON(props.placeAreas, {interactive:false, pane:"places",
      style:{color:"#137d73", weight:2, dashArray:"6 4", fillColor:"#2db6a4", fillOpacity:0.055},
    }).addTo(map);
    return () => { outline.remove(); };
  }, [map,props.placeAreas]);
  useEffect(() => {
    if (!map || (compare && !state.compareHazards)) return;
    const detach = state.active.map((id) =>
      hazardLayer(
        map,
        id,
        props.groups[id] || [],
        (state.settings[id] || initialSetting).opacity,
      ),
    );
    return () => {
      detach.forEach((f) => f());
    };
  }, [
    map,
    props.groups,
    state.active,
    state.settings,
    compare,
    state.compareHazards,
  ]);
  useEffect(() => {
    if (!map) return;
    const node = map.getContainer();
    node.classList.toggle("drawing", !!state.sketch);
    if (state.sketch) {
      vertices.current = [];
      drawing.current?.clearLayers();
    } else if (state.aoi) {
      drawing.current?.clearLayers();
      drawing.current?.addData(state.aoi);
    }
  }, [map, state.aoi, state.sketch]);
  useEffect(() => {
    if (!map) return;
    let alive = true,
      frame = 0;
    let collection: Awaited<ReturnType<typeof loadMapLabels>>;
    const camera = {
      getContainer: () => map.getContainer(),
      getBounds: () => map.getBounds(),
      getZoom: () => map.getZoom() - 1,
      project: (p: [number, number]) => map.latLngToContainerPoint(lonLat(p)),
    };
    function paint() {
      frame = 0;
      if (!collection || !labels.current || !alive) return;
      drawLabels(
        camera,
        labels.current,
        collection,
        state.lang === "ar",
        state.dark || state.base === "dark",
        !!state.imagery ||
          state.base === "satellite" ||
          state.mode === "compare",
      );
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    loadMapLabels()
      .then((v) => {
        if (alive) {
          collection = v;
          schedule();
        }
      })
      .catch(() => {
        if (alive)
          warn(
            "Regional place names unavailable.",
            "تعذّر تحميل أسماء الأماكن.",
          );
      });
    map.on("move zoom resize viewreset", schedule);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      map.off("move zoom resize viewreset", schedule);
    };
  }, [map, state.lang, state.dark, state.base, state.imagery, state.mode]);
  return (
    <>
      <div
        ref={target}
        className="map-surface regional-map"
        role="region"
        aria-label={
          state.lang === "ar" ? "الخريطة التفاعلية" : "Interactive map"
        }
        tabIndex={0}
      />
      <canvas ref={labels} className="map-labels" aria-hidden="true" />
      {compare && (
        <CompareControls
          images={props.compareImages}
          onZoomArea={([w,s,e,n])=>map?.fitBounds([[s,w],[n,e]],{padding:[20,20],animate:false})}
          initial={fraction.current}
          status={[left, right]}
          onSplit={(percent) => {
            fraction.current = percent;
            clip();
          }}
        />
      )}
    </>
  );
}
