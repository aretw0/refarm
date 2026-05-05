import path from "node:path";
import { fileURLToPath } from "node:url";
import { baseConfig, getAliases } from "@refarm.dev/vtconfig";
import { defineConfig, mergeConfig } from "vitest/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default mergeConfig(
	baseConfig,
	defineConfig({
		resolve: {
			alias: {
				...getAliases(path.resolve(__dirname, "../../")),
				"@refarm.dev/context-provider-v1": path.resolve(
					__dirname,
					"../../packages/context-provider-v1/src/index.ts",
				),
				"@refarm.dev/stream-contract-v1": path.resolve(
					__dirname,
					"../../packages/stream-contract-v1/src/index.ts",
				),
			},
		},
		test: { environment: "node", include: ["test/**/*.test.ts"] },
	}),
);
