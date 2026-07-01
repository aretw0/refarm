import { baseConfig, getAliases } from "@refarm.dev/vtconfig";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const aliases = {
  ...getAliases(repoRoot),
  "@refarm.dev/session-contract-v1": path.resolve(
    repoRoot,
    "packages/session-contract-v1/src/index.ts"
  ),
};

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      alias: aliases,
    },
    test: {
      environment: "node",
    },
  })
);
