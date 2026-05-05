import path from "node:path";
import { baseConfig, getAliases } from "@refarm.dev/vtconfig";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
	baseConfig,
	defineConfig({
		resolve: {
			alias: {
				...getAliases(path.resolve(__dirname, "../../")),
				"@refarm.dev/stream-contract-v1": path.resolve(
					__dirname,
					"../stream-contract-v1/src/index.ts",
				),
				"@refarm.dev/file-stream-transport": path.resolve(
					__dirname,
					"../file-stream-transport/src/index.ts",
				),
			},
		},
		test: {
			environment: "node",
			include: ["src/**/*.test.ts"],
		},
	}),
);
