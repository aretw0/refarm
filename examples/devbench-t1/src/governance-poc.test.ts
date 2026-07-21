import { describe, expect, it } from "vitest";

import { createGovernancePocCapability } from "./governance-verb.js";
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

	it("reports an unexercised criterion as unexercised, and keeps it out of the average", () => {
		// The scorecard is offered as objective evidence, so a criterion that scores full marks on
		// no evidence undermines the whole table — and its own note gave it away, reading
		// "0 gates de revisão" beside a 5.
		const { scorecard, metrics } = runGovernancePoc();
		const review = scorecard.criteria.find((c) => c.name.includes("Revisão humana"));

		expect(metrics.humanReviewGates).toBe(0);
		expect(review?.notExercised).toBe(true);
		expect(review?.score).toBeNull();
		expect(review?.note).toContain("não exercitado");

		// The average covers only what ran: recomputing over the scored criteria must reproduce it.
		const scored = scorecard.criteria.filter((c) => typeof c.score === "number");
		const weight = scored.reduce((a, c) => a + c.weight, 0);
		const expected = scored.reduce((a, c) => a + (c.score as number) * c.weight, 0) / weight;
		expect(scorecard.score).toBeCloseTo(expected, 2);
		// And the unexercised one is genuinely excluded — otherwise this weight would match.
		expect(weight).toBeLessThan(scorecard.criteria.reduce((a, c) => a + c.weight, 0));
	});

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

describe("governance-poc --apply — the verifiable artifacts written to disk (shape locked)", () => {
	it("writes one policy-decision/sandbox-report/runtime-evidence per combination + scorecard + metrics", async () => {
		const written = new Map<string, string>();
		const verb = createGovernancePocCapability({
			writeArtifact: (rel, json) => {
				written.set(rel, json);
			},
		});
		const env = (await verb.run({ args: {}, options: { apply: true }, json: true })) as unknown as {
			ok: boolean;
			artifactsWritten: number;
			artifactCount: number;
		};
		expect(env.ok).toBe(true);
		// 6 combinations × 3 files + scorecard + metrics = 20.
		expect(env.artifactCount).toBe(20);
		expect(env.artifactsWritten).toBe(20);
		expect(written.size).toBe(20);

		// The paths follow the documented .dgk/governance/ layout.
		const paths = [...written.keys()];
		expect(paths.filter((p) => p.endsWith(".policy-decision.json"))).toHaveLength(6);
		expect(paths.filter((p) => p.endsWith(".sandbox-report.json"))).toHaveLength(6);
		expect(paths.filter((p) => p.endsWith(".runtime-evidence.json"))).toHaveLength(6);
		expect(written.has(".dgk/governance/scorecard.json")).toBe(true);
		expect(written.has(".dgk/governance/metrics.json")).toBe(true);

		// The artifact SHAPES are load-bearing (the writeup cites them) — assert the keys.
		const scorecard = JSON.parse(written.get(".dgk/governance/scorecard.json")!);
		expect(scorecard).toHaveProperty("criteria");
		expect(scorecard).toHaveProperty("score");
		expect(scorecard).toHaveProperty("gate");
		const anyPolicy = JSON.parse(paths.filter((p) => p.endsWith(".policy-decision.json")).map((p) => written.get(p))[0]!);
		expect(Array.isArray(anyPolicy.decisions)).toBe(true);
	});

	it("without --apply, reports the artifacts but writes NOTHING", async () => {
		let calls = 0;
		const verb = createGovernancePocCapability({ writeArtifact: () => { calls += 1; } });
		const env = (await verb.run({ args: {}, options: {}, json: true })) as unknown as {
			artifactsWritten: number;
			artifactCount: number;
		};
		expect(calls).toBe(0);
		expect(env.artifactsWritten).toBe(0);
		expect(env.artifactCount).toBe(20); // still reports how many it WOULD write
	});
});
