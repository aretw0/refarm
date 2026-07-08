import { baseConfig } from "@refarm.dev/vtconfig";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(baseConfig, defineConfig({ test: { environment: "node" } }));
