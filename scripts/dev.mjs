import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { app, schedule } from "../backend/app.mjs";
const port = Number(process.env.PORT || 5173),
  host = process.env.HOST || "127.0.0.1";
const server = app.listen(port, host, () =>
  console.log("GulfHazard Monitor http://" + host + ":" + port),
);
const vite = await createServer({
  root: fileURLToPath(new URL("../frontend/", import.meta.url)),
  server: { middlewareMode: true, hmr: { server } },
});
app.use(vite.middlewares);
schedule();
