import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
export default defineConfig({
  publicDir: "../gis/public",
  server: {
    fs: {
      allow: [".", "../shared", "../gis/public", "../node_modules"].map(folder =>
        fileURLToPath(new URL(folder + "/", import.meta.url))),
    },
    proxy: {
      "/api": {target:process.env.API_PROXY_TARGET || "http://127.0.0.1:5174", changeOrigin:false},
    },
  },
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/maplibre-gl/")) return "maplibre";
        },
      },
    },
    chunkSizeWarningLimit: 1400,
  },
});
