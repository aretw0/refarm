import { defineConfig } from "astro/config";
import fs from "fs";

const refarmConfig = JSON.parse(
  fs.readFileSync(new URL("../../refarm.config.json", import.meta.url), "utf-8")
);

// Base path configuration for Pages deployment
// - Local development always uses '/' by default
// - Production builds use '/brand.slug' by default
// - Can be overridden via ASTRO_SITE and ASTRO_BASE env vars
const site = process.env.ASTRO_SITE || refarmConfig.brand.urls.site || undefined;
const base = process.env.ASTRO_BASE || (process.env.NODE_ENV === 'production' ? `/${refarmConfig.brand.slug}` : '/');

// https://astro.build/config
export default defineConfig({
  site,
  base,
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
