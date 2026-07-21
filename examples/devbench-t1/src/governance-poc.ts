import { decideCapabilityGrants, type Permission, type PermissionRisk } from "@refarm.dev/plugin-manifest";

/**
 * The GOVERNANCE PoC — extensibility treated as a RISK DECISION, not just a coupling mechanism.
 * An extension (an assisted-review automation) requests the capabilities a real routine would
 * need — read the workspace, write controlled edits, run a check, reach the network. BEFORE any
 * promotion, the host separates those capabilities against a policy: it grants what the profile
 * allows and DENIES the rest; a denied capability is refused, and any widening of permissions
 * stays conditioned on human review.
 *
 * It runs two policy modes over three extension behaviours (2×3 = 6 combinations): a benign
 * extension completes; an extension requesting an out-of-grant capability is blocked; a failing
 * extension is ISOLATED under the tolerant mode but ABORTS the flow under the strict mode. Each
 * run yields verifiable artifacts — a policy decision, a sandbox report, runtime evidence — and a
 * scorecard, so a reviewer can judge technical viability from data, not assertion.
 *
 * This is a LOCAL, SYNTHETIC, self-contained proof: no real or sensitive data, no institutional
 * deployment claimed. It demonstrates viability for an incremental pilot with objective
 * promotion criteria. The policy DECISION here runs through the platform's real capability
 * policy (@refarm.dev/plugin-manifest decideCapabilityGrants — the example consumes it, it
 * does not invent it). The synthetic part is only the sandbox outcome per mode; the ADJACENT
 * `governance-audit` verb executes real WASM and reports the tamper-evidence audit trail the
 * host actually wrote (host-effect:* → scarecrow-audit.ndjson) — so the runtime evidence is
 * available FROM the runtime, not asserted.
 */

/** How strict the host is about a denied capability: tolerant isolates a failing extension and
 * keeps going; strict aborts the whole flow on any denial or failure. */
export type PolicyMode = "tolerant" | "strict";

/** A synthetic extension under test — what it asks for and how it behaves. */
export interface ExtensionUnderTest {
	id: string;
	label: string;
	/** The capabilities the extension requests (a real routine's needs). */
	requests: Permission[];
	/** Whether the extension's own logic fails mid-run (to exercise isolation vs abort). */
	fails?: boolean;
}

/** The policy profile: which capabilities the environment grants, and up to what risk. */
export interface PolicyProfile {
	granted: Permission[];
	/** The maximum risk auto-granted; a higher-risk request needs human review (never auto). */
	maxAutoRisk: PermissionRisk;
}


/** One capability's decision. */
export interface CapabilityDecision {
	capability: Permission;
	risk: PermissionRisk;
	decision: "granted" | "denied" | "review-required";
	reason: string;
}

/** The policy-decision artifact — how the host separated the requested capabilities. */
export interface PolicyDecisionArtifact {
	extension: string;
	mode: PolicyMode;
	profile: { granted: Permission[]; maxAutoRisk: PermissionRisk };
	decisions: CapabilityDecision[];
	/** True if every requested capability was granted (nothing denied or review-gated). */
	fullyGranted: boolean;
}

/** Decide each requested capability against the profile: granted if in the grant set AND within
 * the auto-risk ceiling; review-required if in the grant set but above the ceiling (human gate);
 * denied otherwise. PURE. This is the "separate before promotion" step. */
export function decidePolicy(extension: ExtensionUnderTest, profile: PolicyProfile, mode: PolicyMode): PolicyDecisionArtifact {
	// The risk-tiered grant/deny/review decision is a FRAMEWORK capability
	// (@refarm.dev/plugin-manifest decideCapabilityGrants), sourcing risk from the same
	// permission vocabulary — the example CONSUMES it, it does not reimplement the policy.
	// The governance PoC then wraps the decision in its artifact shape (extension + mode).
	const decisions = decideCapabilityGrants(extension.requests, {
		granted: profile.granted,
		maxAutoRisk: profile.maxAutoRisk,
	}) as CapabilityDecision[];
	return {
		extension: extension.id,
		mode,
		profile: { granted: profile.granted, maxAutoRisk: profile.maxAutoRisk },
		decisions,
		fullyGranted: decisions.every((d) => d.decision === "granted"),
	};
}

/** The outcome of a run: what the host let happen once the capabilities were separated. */
export type RunOutcome = "completed" | "blocked" | "isolated" | "aborted";

/** The sandbox report for one run — the host's account of what executed and how it ended. */
export interface SandboxReportArtifact {
	extension: string;
	mode: PolicyMode;
	outcome: RunOutcome;
	deniedCapabilities: Permission[];
	reviewGatedCapabilities: Permission[];
	/** Human-facing one-line account for the reviewer. */
	summary: string;
}

/** Runtime evidence — the auditable trail of a run (what the observability layer would record). */
export interface RuntimeEvidenceArtifact {
	extension: string;
	mode: PolicyMode;
	outcome: RunOutcome;
	/** The capability decisions, flattened for the audit log. */
	capabilityTrail: Array<{ capability: Permission; decision: string }>;
	/** Whether human review was required before any widening (always true when review-gated). */
	humanReviewRequired: boolean;
}

/** Run one (extension × mode) combination end to end: decide policy, then determine the outcome —
 * a denied capability blocks; a failing extension isolates (tolerant) or aborts (strict); else it
 * completes. Returns the three artifacts. PURE. */
export function runCombination(extension: ExtensionUnderTest, profile: PolicyProfile, mode: PolicyMode): {
	policy: PolicyDecisionArtifact;
	sandbox: SandboxReportArtifact;
	evidence: RuntimeEvidenceArtifact;
} {
	const policy = decidePolicy(extension, profile, mode);
	const denied = policy.decisions.filter((d) => d.decision === "denied").map((d) => d.capability);
	const reviewGated = policy.decisions.filter((d) => d.decision === "review-required").map((d) => d.capability);

	let outcome: RunOutcome;
	let summary: string;
	if (denied.length > 0) {
		// An out-of-grant capability is refused before execution, in either mode.
		outcome = "blocked";
		summary = `Blocked: requested ${denied.join(", ")} outside the grant — refused before promotion.`;
	} else if (extension.fails) {
		// The extension's own logic failed: isolate it (tolerant) or abort the flow (strict).
		outcome = mode === "tolerant" ? "isolated" : "aborted";
		summary =
			mode === "tolerant"
				? "Extension failed; ISOLATED — the fault stayed inside the sandbox, the host kept running."
				: "Extension failed; ABORTED — strict mode stops the flow on any failure.";
	} else {
		outcome = "completed";
		summary = reviewGated.length
			? `Completed the granted capabilities; ${reviewGated.join(", ")} held for human review (never auto-widened).`
			: "Completed within its granted capabilities.";
	}

	return {
		policy,
		sandbox: { extension: extension.id, mode, outcome, deniedCapabilities: denied, reviewGatedCapabilities: reviewGated, summary },
		evidence: {
			extension: extension.id,
			mode,
			outcome,
			capabilityTrail: policy.decisions.map((d) => ({ capability: d.capability, decision: d.decision })),
			humanReviewRequired: reviewGated.length > 0,
		},
	};
}

/** The scorecard — an objective, weighted read of whether the PoC supports an incremental pilot. */
export interface Scorecard {
	criteria: Array<{
		name: string;
		/** null when the run did not exercise this criterion — see `notExercised`. */
		score: number | null;
		weight: number;
		note: string;
		/** The run produced no evidence either way, so the criterion is reported and NOT averaged. */
		notExercised?: boolean;
	}>;
	/** Weighted mean over the EXERCISED criteria only, 0–5. */
	score: number;
	gate: "continue" | "revise";
}

export interface GovernancePocResult {
	combinations: Array<{
		extension: string;
		mode: PolicyMode;
		outcome: RunOutcome;
		policy: PolicyDecisionArtifact;
		sandbox: SandboxReportArtifact;
		evidence: RuntimeEvidenceArtifact;
	}>;
	/** The operational metrics the writeup wires to a decision (evidence in the body). */
	metrics: {
		combinationsRun: number;
		blockedOutOfGrant: number;
		isolatedFailures: number;
		abortedFailures: number;
		humanReviewGates: number;
		/** Fraction of runs that produced a full auditable capability trail. */
		telemetryCoverage: number;
	};
	scorecard: Scorecard;
}

/** The default PoC scenario: the assisted-review extension (benign, out-of-grant, and failing
 * variants) × two policy modes = the six combinations the writeup describes. */
export function defaultScenario(): { extensions: ExtensionUnderTest[]; profile: PolicyProfile; modes: PolicyMode[] } {
	return {
		extensions: [
			{ id: "review-benign", label: "Assisted review (benign)", requests: ["fs:read", "fs:write"] },
			// Requests a high-risk capability the profile does not grant → must be blocked.
			{ id: "review-overreach", label: "Assisted review (out-of-grant)", requests: ["fs:read", "shell:spawn"] },
			// Behaves within grant but its own logic fails → isolate vs abort.
			{ id: "review-failing", label: "Assisted review (failing)", requests: ["fs:read"], fails: true },
		],
		// The environment grants read + controlled write, up to medium risk auto; higher needs review.
		profile: { granted: ["fs:read", "fs:write", "network:outbound"], maxAutoRisk: "medium" },
		modes: ["tolerant", "strict"],
	};
}

/** Run the whole governance PoC: every (extension × mode) combination, the operational metrics,
 * and the scorecard. PURE — a caller persists the artifacts. */
export function runGovernancePoc(
	scenario: { extensions: ExtensionUnderTest[]; profile: PolicyProfile; modes: PolicyMode[] } = defaultScenario(),
): GovernancePocResult {
	const combinations = scenario.modes.flatMap((mode) =>
		scenario.extensions.map((ext) => {
			const { policy, sandbox, evidence } = runCombination(ext, scenario.profile, mode);
			return { extension: ext.id, mode, outcome: sandbox.outcome, policy, sandbox, evidence };
		}),
	);

	const metrics = {
		combinationsRun: combinations.length,
		blockedOutOfGrant: combinations.filter((c) => c.outcome === "blocked").length,
		isolatedFailures: combinations.filter((c) => c.outcome === "isolated").length,
		abortedFailures: combinations.filter((c) => c.outcome === "aborted").length,
		humanReviewGates: combinations.filter((c) => c.evidence.humanReviewRequired).length,
		telemetryCoverage: combinations.length
			? combinations.filter((c) => c.evidence.capabilityTrail.length > 0).length / combinations.length
			: 0,
	};

	// The scorecard: objective criteria a reviewer can check against the artifacts.
	const isolationWorks = metrics.isolatedFailures > 0 && metrics.abortedFailures > 0;
	const blocksOverreach = metrics.blockedOutOfGrant > 0;
	const auditable = metrics.telemetryCoverage >= 0.95;
	// A criterion no combination exercises has no evidence either way. Scoring it full marks
	// would lift the total on the strength of something that never ran — and the note would
	// contradict the score, reading "0 gates de revisão" beside a 5. It is carried, marked, and
	// left out of the average, so the number reflects only what the run actually demonstrated.
	const reviewExercised = metrics.humanReviewGates > 0;
	const criteria = [
		{ name: "Isolamento de falha (tolerante) vs abortar (estrito)", score: isolationWorks ? 5 : 2, weight: 3, note: `${metrics.isolatedFailures} isoladas, ${metrics.abortedFailures} abortadas` },
		{ name: "Bloqueio de capacidade fora da concessão", score: blocksOverreach ? 5 : 1, weight: 3, note: `${metrics.blockedOutOfGrant} bloqueios` },
		{
			name: "Revisão humana antes de ampliar permissão",
			...(reviewExercised ? { score: 5 } : { score: null, notExercised: true }),
			weight: 2,
			note: reviewExercised
				? `${metrics.humanReviewGates} gates de revisão`
				: "não exercitado: nenhuma combinação pede ampliação de permissão",
		},
		{ name: "Trilha de execução auditável (telemetria)", score: auditable ? 5 : 3, weight: 2, note: `${(metrics.telemetryCoverage * 100).toFixed(0)}% cobertura` },
	];
	const scored = criteria.filter((c) => typeof c.score === "number");
	const totalWeight = scored.reduce((a, c) => a + c.weight, 0);
	const score = scored.reduce((a, c) => a + (c.score as number) * c.weight, 0) / totalWeight;
	const scorecard: Scorecard = { criteria, score: Number(score.toFixed(2)), gate: score >= 4 ? "continue" : "revise" };

	return { combinations, metrics, scorecard };
}
