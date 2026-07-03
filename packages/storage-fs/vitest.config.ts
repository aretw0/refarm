import { baseConfig } from "@refarm.dev/vtconfig";
import { defineConfig, mergeConfig } from "vitest/config";

// baseConfig now resolves aliases from its own location (not process.cwd()),
// so it works under `pnpm --filter` without re-declaring getAliases here.
export default mergeConfig(baseConfig, defineConfig({}));
