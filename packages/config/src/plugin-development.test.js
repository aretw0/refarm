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

	it("carries declaredAt, so the state can age out loud", () => {
		const found = readPluginDevelopment({
			pluginDevelopment: { "lsp-code-ops": { declaredAt: "2026-08-26" } },
		});
		expect(found.get("lsp-code-ops")?.declaredAt).toBe("2026-08-26");
	});
});
