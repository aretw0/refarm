import { mergeConfig, defineConfig } from "vitest/config";
import { baseConfig, getAliases } from "../../vitest.config";
import path from "node:path";

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      alias: getAliases(path.resolve(__dirname, "../../"))
    },
    test: {
      environment: "node",
      include: ["test/**/*.test.ts"],
    },
  })
);
