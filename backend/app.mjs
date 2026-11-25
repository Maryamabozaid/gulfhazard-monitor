import express from "express";
import { accountRoutes,requireRole } from "./accounts.mjs";
import {profile,restriction,licensed} from "./licensing.mjs";
import {databaseKind} from "./database.mjs";
import { layers, getLayer, validateWindow, db } from "./store.mjs";
import { channels, rules, addRule, checkAlerts, drainOutbox } from "./alerts.mjs";
import { sourceClass } from "./priority.mjs";
import { eruptionHistory } from "./outlooks.mjs";
import { modisTile } from "./daily-imagery.mjs";
import { dailyDates } from "./gibs-dates.mjs";
import { autoImage, sceneInfo, sentinelTile } from "./imagery.mjs";
import {radarAnalysis} from "./radar.mjs";

export const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "8kb" }));
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.set("X-Frame-Options", "SAMEORIGIN");
  next();
});
const hits = new Map();
app.use("/api", (req, res, next) => {
  const key = req.socket.remoteAddress || "",
    now = Date.now(),
    item = hits.get(key);
  if (!item || item.at < now - 60000) {
    if (hits.size > 4096) hits.clear();
    hits.set(key, { at: now, n: 1 });
  } else if (++item.n > 600)
    return res
      .status(429)
      .set("Retry-After", "60")
      .json({ message: "Request limit reached. Retry in one minute." });
  next();
});
accountRoutes(app);
app.get("/api/health", (_req, res) =>
  res.json({ status: "ok", time: new Date().toISOString() }),
);
app.get("/api/catalog", (_req, res) =>
  res.json({
    layers:licensed(layers),profile,database:databaseKind,
    channels: channels(),
    copernicus: Boolean(
      process.env.CDSE_CLIENT_ID && process.env.CDSE_CLIENT_SECRET,
    ),
  }),
);
app.get("/api/layers/:id", async (req, res) => {
  const { id } = req.params,
    { start, end } = req.query;
  if (!layers.some((l) => l.id === id) || !validateWindow(start, end))
    return res
      .status(400)
      .json({
        message: "Use a known layer and a UTC date window of up to one year.",
      });
  res
    .set("Cache-Control", "no-store")
    .json(await getLayer(id, start, end, req.query.background === "1"));
});
app.get("/api/volcano/:id/eruptions", async (req, res) => {
  if(restriction("volcanoes"))return res.sendStatus(403);
  res.json({ rows: await eruptionHistory(req.params.id) });
});
app.get("/api/slick/:id/origin", async (req, res) => {
  if(restriction("oil"))return res.sendStatus(403);
  res.json({ classes: await sourceClass(req.params.id) });
});
function imageryRoute(resolve,source){
  return async (req,res)=>{
    try {res.set("Cache-Control","no-store").json(await resolve(req.query));}
    catch(e){res.status(e.status||502).json({source,code:e.code||"provider",message:e.message});}
  };
}
app.get("/api/scene",imageryRoute(sceneInfo,"Microsoft Planetary Computer"));
app.get("/api/radar",imageryRoute(radarAnalysis,"Sentinel-1 RTC · Microsoft Planetary Computer"));
app.get("/api/imagery/auto",imageryRoute(autoImage,"NASA GIBS / Microsoft Planetary Computer"));
app.get("/api/imagery/dates",imageryRoute(dailyDates,"NASA GIBS"));
app.get("/api/modis/:date/:z/:x/:y.png",async(req,res)=>{
  try{
    const {date,z,x,y}=req.params;
    const product=req.query.view ?? "true";
    if (!["true","aqua","mosaic","daily"].includes(product)) return res.status(400).json({source:"NASA GIBS",message:"Invalid imagery product."});
    const sensors=["mosaic","daily"].includes(product) ? (await dailyDates({product,date})).sources : [product];
    if (!sensors.length) return res.status(404).json({source:"NASA GIBS",message:"No published observations on this UTC date."});
    const bytes=await modisTile(date,+z,+x,+y,sensors);
    res.type("png").set("Cache-Control","public,max-age=3600").send(bytes);
  }catch(e){res.set("Cache-Control","no-store").status(e.status||502).json({source:"NASA GIBS",message:e.message});}
});
app.get("/api/sentinel/:product/:date/:z/:x/:y.png", async (req, res) => {
  try {
    const p = req.params;
    res
      .type("png")
      .set("Cache-Control", "private,max-age=3600")
      .send(await sentinelTile(p.product, p.date, +p.z, +p.x, +p.y));
  } catch (e) {
    res.status(503).json({ message: e.message });
  }
});
app.get("/api/providers",async(_req,res)=>res.json((await db.query("SELECT layer,success,failure,problem,down FROM providers WHERE profile=$1 ORDER BY layer",[profile])).rows));
app.get("/api/health/providers",async(_req,res)=>{
  const rows=(await db.query("SELECT layer,down,success,failure FROM providers WHERE profile=$1",[profile])).rows;
  const overdue=["earthquakes","oil","fires"].filter(id=>!restriction(id)).filter(id=>{
    const row=rows.find(r=>r.layer===id);
    return !row || Date.now()-Math.max(Date.parse(row.success)||0,Date.parse(row.failure)||0)>Math.max(900,layers.find(l=>l.id===id).ttl+600)*1000;
  });
  const down=rows.filter(r=>r.down).map(r=>r.layer);
  res.set("Cache-Control","no-store").status(down.length||overdue.length?503:200).json({down,overdue});
});
const reader=requireRole("admin","analyst","viewer"),writer=requireRole("admin","analyst");
app.get("/api/alerts",reader,async(req,res)=>{
  const visibleRules=await rules(req.user), ids=visibleRules.map(rule=>rule.id);
  res.json({rules:visibleRules,channels:channels(),
    notifications:(await db.query("SELECT * FROM notifications WHERE rule=ANY($1::text[]) ORDER BY created DESC LIMIT 40",[ids])).rows,
    issues:(await db.query("SELECT rule,event,channel FROM outbox WHERE state='review' AND rule=ANY($1::text[]) LIMIT 40",[ids])).rows});
});
app.post("/api/alerts",writer,async(req,res)=>{
  try{res.status(201).json({id:await addRule(req.body,req.user)});}catch(e){res.status(400).json({message:e.message});}
});
app.delete("/api/alerts/:id",writer,async(req,res)=>{
  await db.query("DELETE FROM rules WHERE id=$1 AND ($2='admin' OR owner_id=$3)",[req.params.id,req.user.role,req.user.id]);res.sendStatus(204);
});
app.use("/api", (_req, res) =>
  res.status(404).json({ message: "Unknown API route." }),
);
app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  res
    .status(err.status>=400 && err.status<500 ? err.status : 500)
    .json({message:err.status>=400 && err.status<500 ? err.message : "The requested operation could not be completed."});
});
export function schedule() {
  const worker=setInterval(()=>drainOutbox().catch(()=>console.warn("Outbox unavailable.")),15000); worker.unref();
  const poll=async()=>{const end=new Date().toISOString().slice(0,10);await Promise.allSettled(["earthquakes","oil","fires"].filter(id=>!restriction(id)).map(id=>getLayer(id,end,end)));};
  const monitor=setInterval(()=>void poll(),300000);monitor.unref();
  void poll();
  const t = setInterval(checkAlerts, 300000);
  t.unref();
  return ()=>{clearInterval(worker);clearInterval(monitor);clearInterval(t);};
}
