import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  site: process.env.SITE || "https://refarm.dev.br" || undefined,
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
