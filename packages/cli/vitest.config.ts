import { mergeConfig, defineConfig } from "vitest/config";
import { baseConfig, getAliases } from "../../vitest.config";
import path from "node:path";

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      alias: getAliases(path.resolve(__dirname, "../../")),
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
      server: {
        deps: {
          // Prevent Vite from transforming the JCO-generated WASM bootstrap —
          // it uses import.meta.url to locate .wasm files, which breaks when
          // Vite replaces import.meta.url with a relative (non-file://) path.
          external: ["@refarm.dev/heartwood", /heartwood\/pkg/],
        },
      },
    },
  })
);
