import { defineConfig } from "vite";
import { withWasmBrowserConfig } from "@refarm.dev/vtconfig";

export default withWasmBrowserConfig(
  defineConfig({
    optimizeDeps: {
      exclude: ["@sqlite.org/sqlite-wasm"],
    },
  }),
);
