import { describe, expect, it } from "vitest";

import { decidePolicy, runCombination, runGovernancePoc, type ExtensionUnderTest, type PolicyProfile } from "./governance-poc.js";

const profile: PolicyProfile = { granted: ["fs:read", "fs:write", "network:outbound"], maxAutoRisk: "medium" };

describe("decidePolicy — separate capabilities before promotion", () => {
	it("grants an in-grant capability within the risk ceiling", () => {
		const ext: ExtensionUnderTest = { id: "e", label: "e", requests: ["fs:read", "fs:write"] };
		const d = decidePolicy(ext, profile, "tolerant");
		expect(d.fullyGranted).toBe(true);
		expect(d.decisions.every((x) => x.decision === "granted")).toBe(true);
	});

	it("denies a capability outside the grant", () => {
		const ext: ExtensionUnderTest = { id: "e", label: "e", requests: ["fs:read", "shell:spawn"] };
		const d = decidePolicy(ext, profile, "tolerant");
		const shell = d.decisions.find((x) => x.capability === "shell:spawn")!;
		expect(shell.decision).toBe("denied");
	});

	it("gates an in-grant but over-ceiling capability for human review", () => {
		// A profile granting shell:spawn (high) but only auto-approving up to low.
		const strictCeiling: PolicyProfile = { granted: ["fs:read", "shell:spawn"], maxAutoRisk: "low" };
		const ext: ExtensionUnderTest = { id: "e", label: "e", requests: ["shell:spawn"] };
		const d = decidePolicy(ext, strictCeiling, "tolerant");
		expect(d.decisions[0]!.decision).toBe("review-required");
	});
});

describe("runCombination — the outcome per (extension × mode)", () => {
	it("a benign extension completes", () => {
		const ext: ExtensionUnderTest = { id: "e", label: "e", requests: ["fs:read", "fs:write"] };
		expect(runCombination(ext, profile, "tolerant").sandbox.outcome).toBe("completed");
	});

	it("an out-of-grant request is blocked in either mode", () => {
		const ext: ExtensionUnderTest = { id: "e", label: "e", requests: ["shell:spawn"] };
		expect(runCombination(ext, profile, "tolerant").sandbox.outcome).toBe("blocked");
		expect(runCombination(ext, profile, "strict").sandbox.outcome).toBe("blocked");
	});

	it("a failing extension is ISOLATED (tolerant) but ABORTS (strict) — the key distinction", () => {
		const ext: ExtensionUnderTest = { id: "e", label: "e", requests: ["fs:read"], fails: true };
		expect(runCombination(ext, profile, "tolerant").sandbox.outcome).toBe("isolated");
		expect(runCombination(ext, profile, "strict").sandbox.outcome).toBe("aborted");
	});
});

describe("runGovernancePoc — the full 2 modes × 3 extensions = 6 combinations", () => {
	const result = runGovernancePoc();

	it("runs exactly 6 combinations", () => {
		expect(result.combinations).toHaveLength(6);
		expect(result.metrics.combinationsRun).toBe(6);
	});

	it("produces the outcomes the writeup describes", () => {
		// 2 blocked (overreach × 2 modes), 1 isolated (failing/tolerant), 1 aborted (failing/strict),
		// 2 completed (benign × 2 modes).
		expect(result.metrics.blockedOutOfGrant).toBe(2);
		expect(result.metrics.isolatedFailures).toBe(1);
		expect(result.metrics.abortedFailures).toBe(1);
	});

	it("has full auditable telemetry coverage", () => {
		expect(result.metrics.telemetryCoverage).toBe(1);
	});

	it("scores the PoC and gates continue when the invariants hold", () => {
		expect(result.scorecard.score).toBeGreaterThanOrEqual(4);
		expect(result.scorecard.gate).toBe("continue");
	});

	it("every combination carries its three verifiable artifacts", () => {
		for (const c of result.combinations) {
			expect(c.policy.decisions.length).toBeGreaterThan(0);
			expect(c.sandbox.summary).toBeTruthy();
			expect(c.evidence.capabilityTrail.length).toBeGreaterThan(0);
		}
	});
});
