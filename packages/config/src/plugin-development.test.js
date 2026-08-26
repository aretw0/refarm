// packages/config/src/plugin-development.test.js
import { describe, expect, it } from "vitest";
import { isUnderDevelopment, readPluginDevelopment } from "./plugin-development.js";

/**
 * The affordance already existed and was expressed by SILENCE: `verify_wasm_integrity` returns
 * Ok for a manifest with no integrity claim, documented as "an un-signed local plugin still
 * loads". So "deliberately unsigned because I am developing it" and "the claim is missing for
 * some other reason" were indistinguishable from every surface.
 */
describe("under development is a declaration this node makes", () => {
	it("keys by the RUNTIME id, the vocabulary the host looks up", () => {
		// Proven 2026-08-25 (57ff5cc1): the load path computes
		// `manifest_runtime_plugin_id(manifest.id)` and looks trust and approvals up under it.
		const config = { pluginDevelopment: { "lsp-code-ops": { declaredAt: "2026-08-26" } } };
		expect(isUnderDevelopment(config, "@refarm/lsp-code-ops")).toBe(true);
	});

	it("is false when nothing declared it, which is the whole point", () => {
		expect(isUnderDevelopment({}, "@refarm/lsp-code-ops")).toBe(false);
	});

	it("reads a malformed declaration as ABSENT, never as present", () => {
		// The same rule `readModelAuthorization` follows: every failure of this parser must land
		// on the state that permits nothing. The alternative is a typo widening what may run.
		expect(readPluginDevelopment({ pluginDevelopment: "all" }).size).toBe(0);
		expect(readPluginDevelopment({ pluginDevelopment: ["x"] }).size).toBe(0);
	});

	it("rejects a top-level ARRAY even when its entries look well-shaped", () => {
		// MEASURED while proving Step 5's guard fires: the two fixtures directly above stay at
		// size 0 even with the top-level `Array.isArray(raw)` check deleted, because the
		// per-entry check (`typeof entry !== "object"`) independently absorbs a bare string's
		// characters and a bare array's non-object elements — so that mutation passed the suite
		// silently. `[{ declaredAt: "2026-01-01" }]` is the fixture that actually depends on the
		// top-level check: its entries ARE well-shaped objects, so only rejecting the array
		// itself (not its contents) keeps this reading ABSENT rather than `{ "0": {...} }`.
		expect(readPluginDevelopment({ pluginDevelopment: [{ declaredAt: "2026-01-01" }] }).size).toBe(
			0,
		);
	});

	it("carries declaredAt, so the state can age out loud", () => {
		const found = readPluginDevelopment({
			pluginDevelopment: { "lsp-code-ops": { declaredAt: "2026-08-26" } },
		});
		expect(found.get("lsp-code-ops")?.declaredAt).toBe("2026-08-26");
	});
});
