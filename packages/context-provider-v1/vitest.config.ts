import { mergeConfig, defineConfig } from "vitest/config";
import { baseConfig } from "@refarm.dev/vtconfig";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      environment: "node",
    },
  })
);
