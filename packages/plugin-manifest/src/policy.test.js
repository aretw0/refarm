import { describe, expect, it } from "vitest";
import { createMockManifest } from "./fixtures.js";
import { decideCapabilityGrants, decidePluginPolicy, evaluateCapabilityGrant } from "./policy.js";

function manifestRequiring(requires) {
	return createMockManifest({
		capabilities: {
			provides: ["storage:v1"],
			requires,
			providesApi: [],
			requiresApi: [],
		},
	});
}

describe("evaluateCapabilityGrant", () => {
	it("returns the required capabilities that are not granted", () => {
		expect(evaluateCapabilityGrant(["storage:v1", "network:v1"], ["storage:v1"])).toEqual([
			"network:v1",
		]);
	});

	it("returns empty when every requirement is granted", () => {
		expect(evaluateCapabilityGrant(["storage:v1"], ["storage:v1"])).toEqual([]);
	});

	it("treats non-arrays defensively", () => {
		expect(evaluateCapabilityGrant(undefined, undefined)).toEqual([]);
		expect(evaluateCapabilityGrant(["a"], undefined)).toEqual(["a"]);
	});
});

describe("decidePluginPolicy", () => {
	it("returns an invalid decision instead of throwing for arbitrary input", () => {
		const decision = decidePluginPolicy({ id: "@example/incomplete" }, {
			grantedCapabilities: [],
			policyMode: "fail-fast",
		});

		expect(decision.status).toBe("invalid-manifest");
		expect(decision.manifestValid).toBe(false);
		expect(decision.manifestErrors[0]).toContain("manifest shape could not be validated");
	});

	it("completes when the granted set satisfies every requirement", () => {
		const decision = decidePluginPolicy(manifestRequiring(["storage:v1"]), {
			grantedCapabilities: ["storage:v1"],
			policyMode: "fail-fast",
		});
		expect(decision).toMatchObject({
			status: "completed",
			manifestValid: true,
			missingCapabilities: [],
		});
	});

	it("blocks (fail-fast) and lists the missing capability", () => {
		const decision = decidePluginPolicy(manifestRequiring(["network:v1"]), {
			grantedCapabilities: ["storage:v1"],
			policyMode: "fail-fast",
		});
		expect(decision).toMatchObject({
			status: "blocked-fail-fast",
			manifestValid: true,
			missingCapabilities: ["network:v1"],
		});
	});

	it("blocks (warn+continue) under the lenient mode", () => {
		const decision = decidePluginPolicy(manifestRequiring(["network:v1"]), {
			grantedCapabilities: ["storage:v1"],
			policyMode: "warn+continue",
		});
		expect(decision.status).toBe("blocked-warn-continue");
		expect(decision.missingCapabilities).toEqual(["network:v1"]);
	});

	it("short-circuits to invalid-manifest for a malformed manifest", () => {
		// A well-formed shape whose id violates the manifest contract (must start
		// with "@"): validation reports an error rather than admitting it.
		const decision = decidePluginPolicy(createMockManifest({ id: "no-scope-prefix" }), {
			grantedCapabilities: ["storage:v1"],
			policyMode: "fail-fast",
		});
		expect(decision).toMatchObject({
			status: "invalid-manifest",
			manifestValid: false,
			missingCapabilities: [],
		});
		expect(decision.manifestErrors.length).toBeGreaterThan(0);
	});

	it("blocks when a declared connection requirement is unavailable", () => {
		const manifest = manifestRequiring([]);
		manifest.capabilities.requiresConnections = ["corporate-vpn"];
		const decision = decidePluginPolicy(manifest, {
			grantedCapabilities: [],
			availableConnections: ["other-vpn"],
			policyMode: "fail-fast",
		});
		expect(decision).toMatchObject({
			status: "blocked-fail-fast",
			missingConnections: ["corporate-vpn"],
		});
	});

	it("completes when every declared connection requirement is available", () => {
		const manifest = manifestRequiring([]);
		manifest.capabilities.requiresConnections = ["corporate-vpn"];
		const decision = decidePluginPolicy(manifest, {
			grantedCapabilities: [],
			availableConnections: ["corporate-vpn"],
			policyMode: "fail-fast",
		});
		expect(decision).toMatchObject({ status: "completed", missingConnections: [] });
	});
});

describe("decideCapabilityGrants — risk-tiered grant/deny/review decision", () => {
	const profile = { granted: ["fs:read", "fs:write", "network:outbound"], maxAutoRisk: "medium" };

	it("grants a capability inside the grant, at or below the risk ceiling", () => {
		const [d] = decideCapabilityGrants(["fs:read"], profile);
		expect(d.decision).toBe("granted");
		expect(d.risk).toBe("low");
	});

	it("denies a capability outside the grant", () => {
		const [d] = decideCapabilityGrants(["shell:spawn"], profile);
		expect(d.decision).toBe("denied");
	});

	it("requires review for an in-grant capability above the auto ceiling", () => {
		// A grant that includes shell:spawn (high) but only auto-approves up to low.
		const strict = { granted: ["fs:read", "shell:spawn"], maxAutoRisk: "low" };
		const [d] = decideCapabilityGrants(["shell:spawn"], strict);
		expect(d.decision).toBe("review-required");
		expect(d.risk).toBe("high");
	});

	it("sources risk from the permission vocabulary, and fails closed for unknown capabilities", () => {
		const [known] = decideCapabilityGrants(["network:outbound"], profile);
		expect(known.risk).toBe("medium"); // from PERMISSIONS, not hardcoded here
		// An unknown capability is high-risk (fail-closed) and, being outside the grant, denied.
		const [unknown] = decideCapabilityGrants(["mystery:cap"], profile);
		expect(unknown.risk).toBe("high");
		expect(unknown.decision).toBe("denied");
	});

	it("decides each requested capability independently", () => {
		const decisions = decideCapabilityGrants(["fs:read", "shell:spawn"], profile);
		expect(decisions.map((d) => d.decision)).toEqual(["granted", "denied"]);
	});
});
