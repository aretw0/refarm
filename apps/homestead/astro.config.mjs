import { defineConfig } from "astro/config";
import fs from "fs";

const refarmConfig = JSON.parse(
  fs.readFileSync(new URL("../../refarm.config.json", import.meta.url), "utf-8")
);

// https://astro.build/config
export default defineConfig({
  site: process.env.SITE || refarmConfig.brand.urls.site || undefined,
  output: "static",
  // Required for WebContainers: these headers enable SharedArrayBuffer
  // which is needed by the in-browser Node.js runtime.
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  vite: {
    optimizeDeps: {
      // Exclude WASM packages from pre-bundling
      exclude: ["@sqlite.org/sqlite-wasm"],
    },
    worker: {
      format: "es",
    },
  },
});
