import { describe, expect, it } from "vitest";

import { missingArtifacts, type LiveRecursionArtifacts } from "./live-recursion.js";
import { missingDelegationArtifacts, type LiveDelegationArtifacts } from "./live-delegation.js";
import { missingCodeOpsArtifacts, type LiveCodeOpsArtifacts } from "./live-code-ops.js";

/**
 * The `missingArtifacts` helpers are the source of the `artifacts_missing` error envelope —
 * the most likely real-world failure (a viewer runs a live verb before building the WASM).
 * The "clear, actionable error" claim rests on these reporting the RIGHT missing names, so
 * lock the behavior here (no daemon, no build).
 */
describe("live-verb artifact detection — the artifacts_missing source of truth", () => {
	it("recursion: reports each missing artifact by key", () => {
		const a: LiveRecursionArtifacts = {
			tractorBinary: "/nope/tractor",
			agentWasm: "/nope/agent.wasm",
			agentManifest: "/nope/plugin.json",
			providerWasm: "/nope/source.wasm",
		};
		expect(missingArtifacts(a).sort()).toEqual(
			["agentManifest", "agentWasm", "providerWasm", "tractorBinary"].sort(),
		);
		// A present path is not reported (use this very test file, which exists).
		expect(missingArtifacts({ ...a, tractorBinary: __filename })).not.toContain("tractorBinary");
	});

	it("delegation: reports each missing artifact by key", () => {
		const a: LiveDelegationArtifacts = {
			tractorBinary: "/nope/tractor",
			agentWasm: "/nope/agent.wasm",
			agentManifest: "/nope/plugin.json",
			delegateWasm: "/nope/delegate.wasm",
			delegateManifest: "/nope/delegate.json",
		};
		expect(missingDelegationArtifacts(a)).toContain("delegateWasm");
		expect(missingDelegationArtifacts({ ...a, delegateWasm: __filename })).not.toContain("delegateWasm");
	});

	it("code-ops: reports missing plugin artifacts AND the vendored fake LSP", () => {
		const a: LiveCodeOpsArtifacts = {
			tractorBinary: "/nope/tractor",
			lspCodeOpsWasm: "/nope/plugin.wasm",
			lspCodeOpsManifest: "/nope/plugin.json",
		};
		const missing = missingCodeOpsArtifacts(a);
		expect(missing).toContain("lspCodeOpsWasm");
		// The fake LSP ships in fixtures/ — it exists, so it is NOT reported missing.
		expect(missing).not.toContain("fakeLsp");
	});
});
