import path from "node:path";

import { baseConfig, getAliases } from "@refarm.dev/vtconfig";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
	baseConfig,
	defineConfig({
		resolve: {
			alias: getAliases(path.resolve(__dirname, "../../")),
		},
		test: {
			environment: "node",
		},
	}),
);
