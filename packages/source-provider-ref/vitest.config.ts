import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		// This is a thin host-side pointer module (WASM path constants + a manifest
		// reader); its real proof is the integration harness that loads the built
		// component, not a unit test. Declare the empty unit surface honestly so
		// `vitest run` passes instead of erroring "No test files found".
		passWithNoTests: true,
	},
});
