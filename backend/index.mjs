import express from "express";
import { fileURLToPath } from "node:url";
import { app, schedule } from "./app.mjs";
import {db} from "./database.mjs";
const apiOnly = process.argv.includes("--api-only");
if (!apiOnly) {
  const dist = fileURLToPath(new URL("../frontend/dist/", import.meta.url));
  app.use(express.static(dist));
  app.get("/{*route}", (_req, res) => res.sendFile("index.html", {root:dist}));
}
const port = Number(apiOnly ? process.env.API_PORT || 5174 : process.env.PORT || 5173),
  host = process.env.HOST || "127.0.0.1";
const server=app.listen(port, host, () =>
  console.log("GulfHazard Monitor http://" + host + ":" + port),
);
const stopJobs=schedule();
let stopping=false;
function stop(){
  if(stopping)return;
  stopping=true;stopJobs();
  server.close(async()=>{await db.close();});
}
process.once("SIGTERM",stop);
process.once("SIGINT",stop);
