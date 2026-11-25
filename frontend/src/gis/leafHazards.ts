import * as L from "leaflet";
import Supercluster from "supercluster";
import { centroid } from "@turf/centroid";
import type { Feature, Point } from "geojson";
import { byId, useStore, type Hazard, type RecordProps } from "../model";

export function lonLat(coordinates: number[]): L.LatLngTuple {
  return [coordinates[1], coordinates[0]];
}

function colorFor(id: string, p: RecordProps) {
  const value = p.severity ?? 0;
  switch (id) {
    case "earthquakes":
      return p.depth >= 200
        ? "#873d58"
        : p.depth >= 70
          ? "#ac433c"
          : p.depth >= 35
            ? "#dd7439"
            : "#e9a645";
    case "fires":
      return value > 30 ? "#b3382c" : value > 5 ? "#d95c34" : "#e09141";
    case "infrastructure":
    case "vessels":
    case "flaring": {
      const maximum = { infrastructure: 12, vessels: 100, flaring: 2 }[id];
      const percent = Math.min(100, Math.max(0, value / maximum * 100));
      return "color-mix(in srgb, " + byId[id].color + " " + percent + "%, #e3e8db)";
    }
    case "oil":
      return Number(p.confidence) >= 0.7
        ? "#51386d"
        : Number(p.confidence) >= 0.4
          ? "#745b90"
          : "#9984a6";
    case "seismic":
      return value >= 0.6
        ? "#582740"
        : value >= 0.35
          ? "#ad353e"
          : value >= 0.15
            ? "#ef944e"
            : "#f8dc83";
    default:
      return byId[id].color;
  }
}

function iconMarker(
  at: L.LatLngTuple,
  text: string,
  color: string,
  size: number,
  itemPane: string,
  className: string,
  label: string,
  opacity: number,
  rotation = 0,
) {
  const badge = document.createElement("span");
  badge.textContent = text;
  badge.style.setProperty("--symbol-color", color);
  badge.style.setProperty("--heading", rotation + "deg");
  const icon = L.divIcon({
    className: "hazard-symbol " + className,
    html: badge,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
  return L.marker(at, {
    icon,
    pane: itemPane,
    title: label,
    alt: label,
    opacity,
    keyboard: true,
    bubblingMouseEvents: true,
  });
}

export function hazardLayer(
  map: L.Map,
  id: string,
  rows: Hazard[],
  opacity: number,
) {
  const itemPane = "hazard-" + id;
  const shapes = L.layerGroup().addTo(map),
    dots = L.layerGroup().addTo(map);
  const lookup = new Map(rows.map((f) => [f.properties.id, f]));
  const points: Feature<Point, RecordProps>[] = [];
  const select = (record: Hazard) => {
    if (!useStore.getState().sketch)
      useStore.getState().patch({ selected: record });
  };
  for (const f of rows) {
    if (f.geometry.type === "Point") {
      points.push(f as Feature<Point, RecordProps>);
    } else {
      const color = colorFor(id, f.properties);
      L.geoJSON(f, {
        pane: itemPane,
        style: {
          color: id === "oil" ? "#80609c" : color,
          weight: id === "oil" ? 2 : 1.1,
          fillColor: color,
          fillOpacity: opacity * 0.55,
          opacity,
        },
      })
        .on("click", () => select(f))
        .addTo(shapes);
      if (id === "oil")
        points.push({ ...centroid(f), properties: f.properties });
    }
  }
  const index = new Supercluster<RecordProps>({
    extent: 256,
    radius: id === "fires" ? 44 : 25,
    maxZoom: id === "fires" ? 9 : 5,
  });
  index.load(points);
  function draw() {
    dots.clearLayers();
    const zoom = Math.floor(map.getZoom());
    if (!points.length || (id === "oil" && zoom >= 9)) return;
    const box = map.getBounds().pad(0.15);
    for (const f of index.getClusters(
      [
        Math.max(-180, box.getWest()),
        box.getSouth(),
        Math.min(180, box.getEast()),
        box.getNorth(),
      ],
      zoom,
    )) {
      const at = lonLat(f.geometry.coordinates);
      const p = f.properties;
      if (p.cluster === true) {
        const n = p.point_count;
        const size = n > 499 ? 34 : n > 74 ? 29 : n > 9 ? 25 : 21;
        iconMarker(
          at,
          String(n < 1000 ? n : (n / 1000).toFixed(1) + "k"),
          byId[id].color,
          size,
          itemPane,
          "cluster-symbol",
          n +
            " · " +
            (useStore.getState().lang === "ar" ? byId[id].ar : byId[id].name),
          opacity,
        )
          .on("click", () => {
            if (!useStore.getState().sketch)
              map.setView(
                at,
                Math.min(
                  map.getMaxZoom(),
                  index.getClusterExpansionZoom(p.cluster_id),
                ),
              );
          })
          .addTo(dots);
        continue;
      }
      const r = lookup.get(p.id);
      if (!r) continue;
      const paint = colorFor(id, r.properties);
      let marker: L.Layer;
      if (["oil", "volcanoes", "flights"].includes(id)) {
        const symbol = id === "volcanoes" ? "▲" : id === "flights" ? "✈" : "◆";
        marker = iconMarker(
          at,
          symbol,
          paint,
          18,
          itemPane,
          "point-symbol",
          r.properties.title,
          opacity,
          id === "flights" ? Number(r.properties.mean_heading || 0) - 90 : 0,
        );
      } else {
        const recent =
          id === "earthquakes" &&
          Date.parse(r.properties.timestamp || "") >= Date.now() - 864e5;
        marker = L.circleMarker(at, {
          pane: itemPane,
          radius:
            id === "earthquakes"
              ? 3 + 1.15 * Math.max(0, r.properties.severity ?? 0)
              : 4.5,
          className: recent ? "recent-quake" : "",
          color: "#fff9ef",
          weight: 1.3,
          opacity,
          fillColor: paint,
          fillOpacity: opacity,
        });
      }
      marker.on("click", () => select(r)).addTo(dots);
    }
  }
  draw();
  map.on("moveend", draw);
  return () => {
    map.off("moveend", draw);
    shapes.remove();
    dots.remove();
  };
}
