import { describe, expect, it } from "vitest";
import { createMockManifest } from "./fixtures.js";
import { decidePluginPolicy, evaluateCapabilityGrant } from "./policy.js";

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
});
