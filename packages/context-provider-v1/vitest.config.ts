import { baseConfig, getAliases } from "@refarm.dev/vtconfig";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      alias: getAliases(repoRoot),
    },
    test: {
      environment: "node",
    },
  })
);
