import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ciVitestOverrides = process.env.GITHUB_ACTIONS === "true"
	? {
		reporters: [
			["github-actions", { jobSummary: { enabled: false } }],
			"default",
			"json",
		],
		outputFile: {
			json: `.artifacts/vitest/report-${(process.env.npm_lifecycle_event || "run").replace(/[^a-zA-Z0-9_-]/g, "-")}.json`,
		},
	}
	: {};

export default defineConfig({
	resolve: {
		alias: {
			"@refarm.dev/plugin-manifest": path.resolve(
				__dirname,
				"../plugin-manifest/src/index.js",
			),
		},
	},
	test: {
		...ciVitestOverrides,
	},
});
