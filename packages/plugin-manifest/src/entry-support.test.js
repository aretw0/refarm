import { describe, expect, it } from "vitest";
import {
	assertEntryRuntimeCompatibility,
	detectEntryFormat,
	evaluateEntryRuntimeCompatibility,
} from "./entry-support";

describe("entry support helpers", () => {
	it("detects supported entry formats", () => {
		expect(detectEntryFormat("./plugin.js")).toBe("js");
		expect(detectEntryFormat("./plugin.mjs?cache=1")).toBe("mjs");
		expect(detectEntryFormat("./plugin.cjs#hash")).toBe("cjs");
		expect(detectEntryFormat("./plugin.wasm")).toBe("wasm");
		expect(detectEntryFormat("./plugin.css")).toBe("unknown");
	});

	it("evaluates runtime compatibility", () => {
		expect(evaluateEntryRuntimeCompatibility("./plugin.cjs", "node")).toEqual({
			runtime: "node",
			format: "cjs",
			supported: true,
		});
		expect(
			evaluateEntryRuntimeCompatibility("./plugin.cjs", "browser"),
		).toEqual({ runtime: "browser", format: "cjs", supported: false });
		expect(
			evaluateEntryRuntimeCompatibility("./plugin.wasm", "browser", {
				allowBrowserWasmFromCache: true,
			}),
		).toEqual({ runtime: "browser", format: "wasm", supported: true });
	});

	it("throws explicit runtime compatibility errors", () => {
		expect(() =>
			assertEntryRuntimeCompatibility("./plugin.css", "node"),
		).toThrow("entry must be a .js/.mjs/.cjs or .wasm path");
		expect(() =>
			assertEntryRuntimeCompatibility("./plugin.cjs", "browser"),
		).toThrow("entry format .cjs is not supported in browser runtime");
		expect(() =>
			assertEntryRuntimeCompatibility("./plugin.wasm", "browser"),
		).toThrow("entry format .wasm is not yet supported in browser runtime");
		expect(() =>
			assertEntryRuntimeCompatibility("./plugin.wasm", "browser", {
				allowBrowserWasmFromCache: true,
			}),
		).not.toThrow();
	});
});
