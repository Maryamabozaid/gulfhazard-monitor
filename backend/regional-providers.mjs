import {
  params,
  json,
  feature,
  point,
  utc,
  inside,
  day,
  addDays,
} from "./net.mjs";
const sgs =
  "https://ngdgis.sgs.gov.sa/ngdweb/rest/services/Geohazards/Earthquake_events/MapServer/0";
async function rows(base, query) {
  const response = await json(
    params(base + "/query", { f: "json", returnGeometry: false, ...query }),
  );
  if (!Array.isArray(response.features)) throw Error("Provider query failed.");
  return response;
}
export async function sgsEvents(start, end) {
  const result = await rows(sgs, {
    where: `ORGINTIME >= TIMESTAMP '${start} 00:00:00' AND ORGINTIME < TIMESTAMP '${addDays(end, 1)} 00:00:00'`,
    geometry: "32,12,60,33",
    geometryType: "esriGeometryEnvelope",
    inSR: 4326,
    spatialRel: "esriSpatialRelIntersects",
    outFields:
      "OBJECTID,ORGINTIME,LATITUDE,LONGITUDE,DEPTH,MAGNITUDEVALUE,MAGNITUDETYPENAME,REGION",
    orderByFields: "ORGINTIME DESC",
    resultRecordCount: 2000,
  });
  return {
    provider: "Saudi Geological Survey",
    partial: result.exceededTransferLimit
      ? "SGS catalogue response truncated."
      : "",
    features: result.features
      .map((f) => f.attributes)
      .filter(
        (p) =>
          inside([p.LONGITUDE, p.LATITUDE]) && Number.isFinite(p.ORGINTIME),
      )
      .map((p) =>
        feature(
          "earthquakes",
          "sgs-" + p.OBJECTID,
          point(p.LONGITUDE, p.LATITUDE),
          {
            title: p.REGION || "SGS catalogue event",
            source: "Saudi Geological Survey",
            source_url: sgs + "/" + p.OBJECTID,
            severity: p.MAGNITUDEVALUE,
            depth: p.DEPTH,
            magnitude_type: p.MAGNITUDETYPENAME,
            timestamp: utc(p.ORGINTIME),
          },
        ),
      ),
  };
}
export function mergeSeismic(primary, regional) {
  const buckets = new Map();
  for (const f of primary) {
    const m = Math.floor(Date.parse(f.properties.timestamp) / 60000);
    const group = buckets.get(m) || [];
    group.push(f);
    buckets.set(m, group);
  }
  return [
    ...primary,
    ...regional.filter((f) => {
      const t = Date.parse(f.properties.timestamp),
        m = Math.floor(t / 60000),
        [x, y] = f.geometry.coordinates;
      return ![m - 1, m, m + 1].some((k) =>
        buckets.get(k)?.some((g) => {
          const [a, b] = g.geometry.coordinates;
          return (
            Math.abs(t - Date.parse(g.properties.timestamp)) <= 30000 &&
            Math.abs(f.properties.severity - g.properties.severity) <= 0.6 &&
            111 * Math.hypot((x - a) * Math.cos((y * Math.PI) / 180), y - b) <
              20
          );
        }),
      );
    }),
  ];
}
const portRoot =
  "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/";
let ports,
  portsUntil = 0;
export async function portActivity(start, end) {
  if (!ports || Date.now() > portsUntil) {
    const r = await rows(
      portRoot + "PortWatch_ports_database/FeatureServer/0",
      {
        where: "1=1",
        geometry: "32,12,60,33",
        inSR: 4326,
        geometryType: "esriGeometryEnvelope",
        spatialRel: "esriSpatialRelIntersects",
        outFields: "portid,lat,lon,ISO3",
        resultRecordCount: 2000,
      },
    );
    ports = new Map(r.features.map((f) => [f.attributes.portid, f.attributes]));
    portsUntil = Date.now() + 86400000;
  }
  const provider = "IMF PortWatch",
    uri = portRoot + "Daily_Ports_Data/FeatureServer/0";
  if (!ports.size) throw Error("Port catalogue unavailable.");
  const ids = [...ports.keys()].filter((id) => /^port\d+$/.test(id));
  const cells = new Map();
  let offset = 0,
    more = false;
  do {
    const r = await rows(uri, {
      where: `portid IN (${ids.map((id) => "'" + id + "'").join(",")}) AND date>=DATE '${start}' AND date<DATE '${addDays(end, 1)}'`,
      outFields: "portid,date,portcalls,ObjectId",
      orderByFields: "date DESC,ObjectId",
      resultOffset: offset,
      resultRecordCount: 2000,
    });
    for (const { attributes: p } of r.features) {
      const port = ports.get(p.portid);
      if (!port || !Number.isFinite(p.portcalls)) continue;
      const x = Math.floor(port.lon) + 0.5,
        y = Math.floor(port.lat) + 0.5,
        date = day(p.date),
        key = [x, y, date].join("|");
      const cell = cells.get(key) || { x, y, date, count: 0, ports: 0 };
      cell.count += p.portcalls;
      cell.ports++;
      cells.set(key, cell);
    }
    offset += r.features.length;
    more = !!r.exceededTransferLimit && r.features.length > 0;
  } while (more && offset < 50000);
  return {
    provider,
    partial: more ? "PortWatch record limit reached." : "",
    features: [...cells].map(([key, c]) =>
      feature("portcalls", key, point(c.x, c.y), {
        title: "Daily port calls",
        severity: c.count,
        ports: c.ports,
        timestamp: c.date + "T00:00:00Z",
        source: provider,
        source_url: "https://portwatch.imf.org/",
      }),
    ),
  };
}
