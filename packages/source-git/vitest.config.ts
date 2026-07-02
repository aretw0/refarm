import { baseConfig, getAliases } from "@refarm.dev/vtconfig";
import path from "node:path";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
	baseConfig,
	defineConfig({
		resolve: {
			alias: {
				...getAliases(path.resolve(__dirname, "../../")),
				"@refarm.dev/source-contract-v1": path.resolve(
					__dirname,
					"../source-contract-v1/src/index.ts",
				),
			},
		},
		test: {
			environment: "node",
		},
	}),
);
