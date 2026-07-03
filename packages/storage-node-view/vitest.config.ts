import { baseConfig } from "@refarm.dev/vtconfig";
import { defineConfig, mergeConfig } from "vitest/config";

// baseConfig resolves workspace aliases from its own location, so it works
// under `pnpm --filter` without re-declaring getAliases here.
export default mergeConfig(baseConfig, defineConfig({ test: { environment: "node" } }));
