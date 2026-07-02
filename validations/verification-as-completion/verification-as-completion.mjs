import { createHash } from "node:crypto";
import { TASK_ARTIFACT_MANIFEST_SCHEMA } from "../../packages/artifact-contract-v1/dist/index.js";

export const ISSUED_AT = "2026-07-01T00:00:00.000Z";
export const TASK_ID = "task-verification-as-completion-proof";
export const EFFORT_ID = "effort-verification-as-completion-proof-001";
export const RUN_ID = "verification-as-completion-proof-001";
export const PROOF_SCHEMA = "refarm.verification-as-completion.proof.v1";

export function buildSourceTruth() {
	const body = JSON.stringify({
		id: "source-fixture:requirements-note",
		title: "Requirements note",
		status: "verified",
		records: [
			{
				id: "record:1",
				kind: "requirement",
				text: "Completion must be backed by re-observed evidence.",
			},
		],
	}, null, 2);
	return {
		schema: "refarm.source-truth.fixture.v1",
		sourceRef: "source-fixture://verification-as-completion/requirements-note.json",
		mediaType: "application/json",
		body,
		hash: sha256Text(body),
	};
}

export function buildToolObservation(sourceTruth = buildSourceTruth()) {
	const rawOutput = [
		"command: validate requirements note",
		`sourceRef: ${sourceTruth.sourceRef}`,
		`observedHash: ${sourceTruth.hash.value}`,
		"result: ok",
	].join("\n");
	return {
		schema: "refarm.tool-observation.proof.v1",
		command: {
			display: "node validations/verification-as-completion/verification-as-completion.mjs",
			exitCode: 0,
			elapsedMs: 42,
		},
		rawEvidence: {
			uri: "verification-as-completion.raw.ndjson",
			mediaType: "application/x-ndjson",
			hash: sha256Text(`${rawOutput}\n`),
			retention: "local-proof-artifact",
		},
		compactView: {
			summary: "Validated source fixture and captured observed source hash.",
			focus: ["exit-code", "observed-source-hash", "verification-input"],
			rawEvidenceRecoverable: true,
		},
		policy: {
			redaction: "none-fixture",
			compactViewIsTruth: false,
		},
		observed: {
			sourceRef: sourceTruth.sourceRef,
			hash: sourceTruth.hash,
		},
	};
}

export function buildVerificationEvidence({
	sourceTruth = buildSourceTruth(),
	observation = buildToolObservation(sourceTruth),
} = {}) {
	const hashMatches = observation.observed.hash.value === sourceTruth.hash.value;
	const sourceMatches = observation.observed.sourceRef === sourceTruth.sourceRef;
	return {
		schema: "refarm.verification-evidence.proof.v1",
		method: "source-hash-reobservation",
		sourceRef: sourceTruth.sourceRef,
		expectedHash: sourceTruth.hash,
		observedHash: observation.observed.hash,
		checks: [
			{
				id: "source-ref-matches",
				ok: sourceMatches,
				summary: "Observation points back to the same source ref.",
			},
			{
				id: "source-hash-matches",
				ok: hashMatches,
				summary: "Observed source hash equals the source-of-truth hash.",
			},
			{
				id: "raw-evidence-recoverable",
				ok: observation.compactView.rawEvidenceRecoverable === true,
				summary: "Compact observation links back to durable raw evidence.",
			},
		],
	};
}

export function buildCompletionDecision({
	observation = buildToolObservation(),
	verification = buildVerificationEvidence({ observation }),
} = {}) {
	const verificationOk = verification.checks.every((check) => check.ok === true);
	const commandOk = observation.command.exitCode === 0;
	return {
		schema: "refarm.completion-decision.proof.v1",
		state: verificationOk && commandOk ? "completed" : "blocked",
		claim: "done",
		commandExitCode: observation.command.exitCode,
		requiresVerification: true,
		verificationOk,
		reasons: [
			commandOk ? "command-exit-ok" : "command-exit-failed",
			verificationOk ? "verification-evidence-ok" : "verification-evidence-failed",
		],
	};
}

export function buildToollessDelegation() {
	return {
		schema: "refarm.toolless-delegation.proof.v1",
		orchestrator: {
			id: "farmhand-conductor-fixture",
			holdsOperatorKeys: true,
			toolCapabilities: [],
			role: "plan-delegate-verify",
		},
		actor: {
			id: "keyless-source-observer-fixture",
			holdsOperatorKeys: false,
			keyless: true,
			toolCapabilities: ["source-read", "bounded-process"],
			returns: ["tool-observation", "verification-evidence"],
		},
		boundary: {
			orchestratorOwnsTools: false,
			actorCanEscalateKeys: false,
			fencedSummaryRequired: true,
		},
	};
}

export function buildContextMap() {
	return {
		schema: "refarm.context-map.proof.v1",
		capability: "context:v1",
		home: "@refarm.dev/context-provider-v1",
		reversibleFold: {
			enabled: true,
			foldId: "fold:verification-as-completion:001",
			foldedEntryRefs: ["turn:research-peerd", "turn:research-rtk", "turn:research-terax"],
			protectedTailEntryRefs: ["turn:current-proof"],
			unfoldPolicy: "consumer-owned session store lookup; compact prompt is not the source of truth",
		},
		contextMapVisibleToOperator: true,
	};
}

export function buildVerificationAsCompletionProof() {
	const sourceTruth = buildSourceTruth();
	const observation = buildToolObservation(sourceTruth);
	const verification = buildVerificationEvidence({ sourceTruth, observation });
	const completion = buildCompletionDecision({ observation, verification });
	const report = {
		schema: PROOF_SCHEMA,
		createdAt: ISSUED_AT,
		sourceTruth,
		observation,
		verification,
		completion,
		toollessDelegation: buildToollessDelegation(),
		contextMap: buildContextMap(),
		boundary: {
			packageExtraction: false,
			appOwnedContract: false,
			productReady: false,
			runtimeMutation: false,
			publicApi: false,
			candidateHomes: [
				"effort-contract-v1",
				"artifact-contract-v1",
				"process-handoff",
				"context-provider-v1",
				"future tool-observation:v1",
			],
		},
	};
	return {
		...report,
		artifactManifest: buildTaskArtifactManifest(report),
	};
}

export function validateVerificationAsCompletionProof(proof) {
	const issues = [];
	if (proof?.schema !== PROOF_SCHEMA) {
		issues.push("proof schema must stay proof-local");
	}
	if (proof?.completion?.state !== "completed") {
		issues.push("completion must be completed only for verified evidence");
	}
	if (proof?.completion?.verificationOk !== true) {
		issues.push("completion must require verificationOk=true");
	}
	if (proof?.observation?.policy?.compactViewIsTruth !== false) {
		issues.push("compact observation must not be treated as truth");
	}
	if (proof?.observation?.compactView?.rawEvidenceRecoverable !== true) {
		issues.push("compact observation must link back to raw evidence");
	}
	if (!proof?.verification?.checks?.every((check) => check.ok === true)) {
		issues.push("all verification checks must pass");
	}
	if (proof?.toollessDelegation?.orchestrator?.toolCapabilities?.length !== 0) {
		issues.push("tool-less orchestrator must not own environment tools");
	}
	if (proof?.toollessDelegation?.actor?.keyless !== true) {
		issues.push("delegated actor must be keyless");
	}
	if (proof?.contextMap?.capability !== "context:v1") {
		issues.push("context map must target context:v1");
	}
	if (proof?.contextMap?.reversibleFold?.enabled !== true) {
		issues.push("context map must preserve reversible folding");
	}
	if (proof?.boundary?.packageExtraction !== false) {
		issues.push("first proof must not extract a package");
	}
	if (proof?.boundary?.appOwnedContract !== false) {
		issues.push("first proof must not be app-owned");
	}
	return { ok: issues.length === 0, issues };
}

export function buildTaskArtifactManifest(report) {
	const hash = sha256Json(report);
	return {
		schema: TASK_ARTIFACT_MANIFEST_SCHEMA,
		taskId: TASK_ID,
		effortId: EFFORT_ID,
		createdAt: ISSUED_AT,
		artifacts: [
			{
				id: "verification-as-completion-proof",
				uri: "verification-as-completion-proof.json",
				mediaType: "application/json",
				role: "audit-trail",
				hash,
				reviewState: "unreviewed",
				labels: ["verification-as-completion", "tool-observation", "context-map", "proof"],
				provenance: {
					runId: RUN_ID,
					producer: "verification-as-completion:proof",
					command: "pnpm run verification-completion:poc:test",
					source: "validations/verification-as-completion",
					producedAt: ISSUED_AT,
					inputHashes: [
						report.sourceTruth.hash,
						report.observation.rawEvidence.hash,
					],
				},
			},
		],
	};
}

function sha256Json(value) {
	return sha256Text(`${JSON.stringify(value, null, 2)}\n`);
}

function sha256Text(value) {
	return {
		algorithm: "sha256",
		value: createHash("sha256").update(value).digest("hex"),
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	console.log(JSON.stringify(buildVerificationAsCompletionProof(), null, 2));
}
