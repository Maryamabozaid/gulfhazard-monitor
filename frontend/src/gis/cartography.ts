import type { Map as GLMap, StyleSpecification } from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";
let labels: Promise<FeatureCollection<Point>> | undefined;
export const loadLabels = (): Promise<FeatureCollection<Point>> =>
  (labels ??= fetch("/cartography/labels.geojson").then((r) => {
    if (!r.ok) throw Error("Regional labels unavailable");
    return r.json();
  }).catch(error => { labels = undefined; throw error; }));
type Town = [number, number, number, string, string, number, string];
let detailed: Promise<FeatureCollection<Point>> | undefined;
export function loadPlaceLabels(): Promise<FeatureCollection<Point>> {
  return detailed ??= Promise.all([loadLabels(),fetch("/cartography/places.json").then(r=>{
    if(!r.ok)throw Error("Regional places unavailable");return r.json() as Promise<Town[]>;
  })]).then(([base, towns])=>({type:"FeatureCollection" as const,features:[...base.features,...towns.map(([id,x,y,name,ar,rank,country])=>({
    type:"Feature" as const,id,geometry:{type:"Point" as const,coordinates:[x,y]},
    properties:{kind:"city",name,ar,rank,country,source:"GeoNames"}
  }))]})).catch(error=>{detailed=undefined;throw error;});
}
export function loadMapLabels() {
  return loadPlaceLabels().catch(()=>loadLabels());
}
type Place = FeatureCollection<Point>["features"][number];
const indices = new WeakMap<FeatureCollection<Point>,{overview: Place[], cells: Map<string,Place[]>}>();
function placesInView(data: FeatureCollection<Point>,z:number,b:{getWest():number;getEast():number;getSouth():number;getNorth():number}) {
  let index=indices.get(data);
  if(!index){
    index={overview:[],cells:new Map()};
    for(const f of data.features){
      if((f.properties?.rank??0)<5){index.overview.push(f);continue;}
      const [x,y]=f.geometry.coordinates,key=Math.floor(x)+","+Math.floor(y);
      const items=index.cells.get(key)??[];items.push(f);index.cells.set(key,items);
    }
    indices.set(data,index);
  }
  if(z<6.5)return index.overview;
  const list=[...index.overview];
  for(let x=Math.max(32,Math.floor(b.getWest())); x<=Math.min(60,Math.floor(b.getEast()));x++){
    for(let y=Math.max(12,Math.floor(b.getSouth()));y<=Math.min(33,Math.floor(b.getNorth()));y++){
      for(const f of index.cells.get(x+","+y)??[]){
        if(z >= ({5:6.5,6:8,7:9.5}[f.properties!.rank as 5|6|7]??9.5))list.push(f);
      }
    }
  }
  return list;
}
export const empty = { type: "FeatureCollection" as const, features: [] };
const regional = [21, 3, 74, 43] as [number, number, number, number];
export function baseStyle(dark: boolean, base: string, onlineDetail=true): StyleSpecification {
  const isDark = base === "dark" || (dark && base === "light"),
    land = isDark ? "#303739" : "#f5f3ed",
    sea = isDark ? "#1d303b" : "#c9dce2";
  const remote = base === "satellite" || base === "terrain",
    gray = isDark ? "World_Dark_Gray_Base" : "World_Light_Gray_Base";
  return {
    version: 8,
    glyphs: location.origin + "/fonts/{range}.pbf?font={fontstack}",
    sources: {
      land: { type: "geojson", data: "/cartography/world.geojson" },
      water: { type: "geojson", data: "/cartography/water.geojson" },
      provinces: { type: "geojson", data: "/cartography/provinces.geojson" },
      relief: {
        type: "image",
        url: "/cartography/relief.webp",
        coordinates: [
          [22.5, 40.97989807],
          [73.125, 40.97989807],
          [73.125, 0],
          [22.5, 0],
        ],
      },
      ...(base === "vector"
        ? {
            streets: {
              type: "vector" as const,
              url: "https://tiles.openfreemap.org/planet",
            },
          }
        : {}),
      ...(onlineDetail?{tiles: {
        type: "raster" as const,
        tiles: [
          base === "satellite"
            ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            : base === "terrain"
              ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
              : "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/" + gray + "/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 19,
        bounds: regional,
      }}:{}),
    },
    layers: [
      { id: "ocean", type: "background", paint: { "background-color": sea } },
      {
        id: "land",
        type: "fill",
        source: "land",
        paint: { "fill-color": land },
      },
      {
        id: "relief",
        type: "raster",
        source: "relief",
        paint: {
          "raster-opacity": isDark ? 0.35 : 0.86,
          "raster-fade-duration": 0,
        },
      },
      {
        id: "lakes",
        type: "fill",
        source: "water",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": sea },
      },
      {
        id: "rivers",
        type: "line",
        source: "water",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": isDark ? "#385059" : "#b9d1d8",
          "line-width": 0.8,
        },
      },
      {
        id: "provinces",
        type: "line",
        source: "provinces",
        paint: {
          "line-color": isDark ? "#586064" : "#c2beb5",
          "line-opacity": 0.62,
          "line-width": 0.75,
          "line-dasharray": [2, 2],
        },
      },
      {
        id: "borders",
        type: "line",
        source: "land",
        paint: {
          "line-color": isDark ? "#828b8b" : "#a6a79e",
          "line-width": 1.05,
          "line-opacity": 0.86,
        },
      },
      ...(onlineDetail?[{
        id: "detail",
        type: "raster" as const,
        source: "tiles",
        minzoom: remote ? 0 : 7,
        paint: {
          "raster-opacity": remote ? 1 : 0.85,
          "raster-fade-duration": 200,
        },
      }]:[]),
      ...(base === "vector"
        ? [
            {
              id: "street-lines",
              type: "line" as const,
              source: "streets",
              "source-layer": "transportation",
              minzoom: 4,
              paint: {
                "line-color": isDark ? "#8b8673" : "#bcaa84",
                "line-width": 1,
                "line-opacity": 0.68,
              },
            },
          ]
        : []),
    ],
  };
}
export function drawLabels(
  map: Pick<GLMap, "getContainer" | "getZoom"> & {getBounds(): {getWest():number;getEast():number;getSouth():number;getNorth():number};project(p: [number, number]): {x: number; y: number}},
  canvas: HTMLCanvasElement,
  data: FeatureCollection<Point>,
  ar: boolean,
  dark: boolean,
  photo: boolean,
) {
  const rect = map.getContainer().getBoundingClientRect(),
    w = rect.width,
    h = rect.height,
    dpr = window.devicePixelRatio || 1;
  if (
    canvas.width !== Math.round(w * dpr) ||
    canvas.height !== Math.round(h * dpr)
  ) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const c = canvas.getContext("2d");
  if (!c) return;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const z = map.getZoom(),
    occupied: number[][] = [];
  const sorted = [...placesInView(data,z,map.getBounds())].sort(
    (a, b) =>
      (a.properties!.kind === "country"
        ? 0
        : a.properties!.kind === "sea"
          ? 10
          : 25) +
      a.properties!.rank -
      ((b.properties!.kind === "country"
        ? 0
        : b.properties!.kind === "sea"
          ? 10
          : 25) +
        b.properties!.rank),
  );
  for (const f of sorted) {
    const p = f.properties!,
      kind = p.kind,
      city = kind === "city",
      sea = kind === "sea";
    if(z >= 9 && !city) continue;
    if (
      city &&
      ((z < 3.7 && p.rank > 1) ||
        (z < 4.7 && p.rank > 2) ||
        (z < 5.2 && p.rank > 3))
    )
      continue;
    const { x, y } = map.project(f.geometry.coordinates as [number, number]);
    if (x < 0 || y < 0 || x > w || y > h) continue;
    const label = ar
      ? p.ar || p.name
      : kind === "country"
        ? p.name.toUpperCase()
        : p.name;
    const size = city ? 11 : sea ? 14 : p.rank === 0 ? 16 : 12;
    c.font =
      (sea ? "italic 500 " : city ? "480 " : "660 ") +
      size +
      "px " +
      (sea ? "Georgia, serif" : "Inter, Arial, sans-serif");
    c.textAlign = "center";
    c.textBaseline = "middle";
    if ("letterSpacing" in c)
      c.letterSpacing = ar
        ? "0px"
        : kind === "country"
          ? p.rank === 0
            ? "2.3px"
            : "1.45px"
          : sea
            ? "1.4px"
            : "0px";
    const width = c.measureText(label).width,
      yy = y + (city ? 9 : 0),
      box = [
        x - width / 2 - 3,
        yy - size / 2 - 2,
        x + width / 2 + 3,
        yy + size / 2 + 2,
      ];
    if (
      occupied.some(
        (b) => b[0] < box[2] && b[2] > box[0] && b[1] < box[3] && b[3] > box[1],
      )
    )
      continue;
    occupied.push(box);
    const hi = dark || photo;
    c.save();
    c.translate(x, yy);
    if (sea) c.rotate(((p.rotation || 0) * Math.PI) / 180);
    c.lineJoin = "round";
    c.lineWidth = city ? 2.4 : 3.2;
    c.strokeStyle = hi
      ? "rgba(30,35,37,.74)"
      : sea
        ? "rgba(222,236,238,.59)"
        : "rgba(249,247,242,.88)";
    c.strokeText(label, 0, 0);
    c.fillStyle = hi
      ? "#f3f3ee"
      : sea
        ? "#547f90"
        : city
          ? "#515954"
          : "#47504c";
    c.fillText(label, 0, 0);
    c.restore();
    if (city) {
      c.beginPath();
      c.arc(x, y, 1.8, 0, Math.PI * 2);
      c.fillStyle = hi ? "#ddd" : "#747a71";
      c.fill();
    }
  }
}
