import { createHash } from "node:crypto";
import { TASK_ARTIFACT_MANIFEST_SCHEMA } from "../../packages/artifact-contract-v1/dist/index.js";

export const ISSUED_AT = "2026-07-01T00:00:00.000Z";
export const TASK_ID = "task-toolless-orchestrator-proof";
export const EFFORT_ID = "effort-toolless-orchestrator-proof-001";
export const RUN_ID = "toolless-orchestrator-proof-001";
export const PROOF_SCHEMA = "refarm.toolless-orchestrator.proof.v1";

export function buildSourceTruth() {
	const body = JSON.stringify({
		id: "source-fixture:bounded-workspace-status",
		status: "ready",
		message: "Bounded actor observed the source without operator keys.",
	}, null, 2);
	return {
		schema: "refarm.toolless-orchestrator.source-truth.v1",
		sourceRef: "source-fixture://toolless-orchestrator/workspace-status.json",
		mediaType: "application/json",
		body,
		hash: sha256Text(body),
	};
}

export function buildConductor(overrides = {}) {
	return {
		id: "farmhand-conductor-fixture",
		role: "plan-delegate-verify",
		holdsOperatorKeys: true,
		environmentToolCapabilities: [],
		allowedActions: ["delegate", "verify-evidence", "decide"],
		forbiddenActions: ["source-read", "bounded-process", "network-egress", "filesystem-write"],
		...overrides,
	};
}

export function buildActor(overrides = {}) {
	return {
		id: "keyless-workspace-actor-fixture",
		role: "bounded-environment-worker",
		holdsOperatorKeys: false,
		keyless: true,
		environmentToolCapabilities: ["source-read", "bounded-process"],
		policy: {
			allowedSourceRefs: ["source-fixture://toolless-orchestrator/workspace-status.json"],
			allowedCommands: ["observe-source-hash"],
			egress: "none",
			maxElapsedMs: 1000,
		},
		...overrides,
	};
}

export function buildDelegationRequest({
	sourceTruth = buildSourceTruth(),
	requestedCapabilities = ["source-read"],
	secretMaterialProvided = false,
} = {}) {
	return {
		schema: "refarm.toolless-orchestrator.delegation-request.v1",
		id: "delegation:workspace-status:001",
		sourceRef: sourceTruth.sourceRef,
		command: "observe-source-hash",
		requestedCapabilities,
		secretMaterialProvided,
		evidenceContract: "fenced-observation-with-source-hash",
	};
}

export function buildActorEvidence({
	actor = buildActor(),
	sourceTruth = buildSourceTruth(),
	request = buildDelegationRequest({ sourceTruth }),
} = {}) {
	const observed = {
		sourceRef: request.sourceRef,
		hash: sourceTruth.hash,
		command: request.command,
		exitCode: 0,
	};
	const compactSummary = [
		`actor: ${actor.id}`,
		`sourceRef: ${observed.sourceRef}`,
		`observedHash: ${observed.hash.value}`,
		"result: ok",
	].join("\n");
	return {
		schema: "refarm.toolless-orchestrator.fenced-evidence.v1",
		producer: actor.id,
		actorKeyless: actor.keyless === true,
		includes: ["tool-observation", "source-hash-evidence"],
		excludes: ["operator-keys", "ambient-shell", "unbounded-egress"],
		rawEvidence: {
			uri: "toolless-orchestrator.raw.ndjson",
			mediaType: "application/x-ndjson",
			hash: sha256Text(`${compactSummary}\n`),
			retention: "local-proof-artifact",
		},
		compactView: {
			summary: "Keyless actor observed bounded source evidence.",
			rawEvidenceRecoverable: true,
			compactViewIsTruth: false,
		},
		observed,
	};
}

export function buildConductorDecision({
	conductor = buildConductor(),
	actor = buildActor(),
	sourceTruth = buildSourceTruth(),
	request = buildDelegationRequest({ sourceTruth }),
	evidence = buildActorEvidence({ actor, sourceTruth, request }),
} = {}) {
	const allowedCapabilities = new Set(actor.environmentToolCapabilities);
	const requestedCapabilitiesAllowed = request.requestedCapabilities.every((capability) =>
		allowedCapabilities.has(capability),
	);
	const checks = [
		{
			id: "conductor-has-no-environment-tools",
			ok: conductor.environmentToolCapabilities.length === 0,
		},
		{
			id: "actor-is-keyless",
			ok: actor.keyless === true && actor.holdsOperatorKeys === false,
		},
		{
			id: "request-carries-no-secret-material",
			ok: request.secretMaterialProvided === false,
		},
		{
			id: "requested-capabilities-are-actor-bounded",
			ok: requestedCapabilitiesAllowed,
		},
		{
			id: "fenced-evidence-excludes-keys-and-ambient-shell",
			ok:
				evidence.excludes.includes("operator-keys") &&
				evidence.excludes.includes("ambient-shell"),
		},
		{
			id: "source-hash-reobserved",
			ok:
				evidence.observed.sourceRef === sourceTruth.sourceRef &&
				evidence.observed.hash.value === sourceTruth.hash.value,
		},
		{
			id: "compact-view-is-not-truth",
			ok:
				evidence.compactView.compactViewIsTruth === false &&
				evidence.compactView.rawEvidenceRecoverable === true,
		},
	];
	const ok = checks.every((check) => check.ok);
	return {
		schema: "refarm.toolless-orchestrator.conductor-decision.v1",
		state: ok ? "completed" : "blocked",
		claim: "delegated-work-verified",
		checks,
	};
}

export function buildToollessOrchestratorProof(overrides = {}) {
	const sourceTruth = overrides.sourceTruth ?? buildSourceTruth();
	const conductor = overrides.conductor ?? buildConductor();
	const actor = overrides.actor ?? buildActor();
	const request = overrides.request ?? buildDelegationRequest({ sourceTruth });
	const evidence = overrides.evidence ?? buildActorEvidence({ actor, sourceTruth, request });
	const decision = overrides.decision ??
		buildConductorDecision({
			conductor,
			actor,
			sourceTruth,
			request,
			evidence,
		});
	const report = {
		schema: PROOF_SCHEMA,
		createdAt: ISSUED_AT,
		sourceTruth,
		conductor,
		actor,
		request,
		evidence,
		decision,
		boundary: {
			packageExtraction: false,
			runtimeMutation: false,
			appOwnedPolicy: false,
			globalShellProxy: false,
			publicApi: false,
			candidateHomes: [
				"pi-agent/farmhand runtime conductor",
				"process-handoff",
				"environment ceilings",
				"future worker/session contracts",
			],
		},
	};
	return {
		...report,
		artifactManifest: buildTaskArtifactManifest(report),
	};
}

export function validateToollessOrchestratorProof(proof) {
	const issues = [];
	if (proof?.schema !== PROOF_SCHEMA) {
		issues.push("proof schema must stay proof-local");
	}
	if (proof?.conductor?.environmentToolCapabilities?.length !== 0) {
		issues.push("conductor must not own environment tools");
	}
	if (proof?.actor?.keyless !== true || proof?.actor?.holdsOperatorKeys !== false) {
		issues.push("actor must be keyless and must not hold operator keys");
	}
	if (proof?.request?.secretMaterialProvided !== false) {
		issues.push("delegation request must not carry secret material");
	}
	if (proof?.decision?.state !== "completed") {
		issues.push("decision must complete only when all evidence checks pass");
	}
	if (!proof?.decision?.checks?.every((check) => check.ok === true)) {
		issues.push("all conductor checks must pass");
	}
	if (proof?.boundary?.packageExtraction !== false) {
		issues.push("first proof must not extract a package");
	}
	if (proof?.boundary?.runtimeMutation !== false) {
		issues.push("first proof must not mutate runtime behavior");
	}
	if (proof?.boundary?.appOwnedPolicy !== false) {
		issues.push("first proof must not move policy into an app");
	}
	if (proof?.artifactManifest?.schema !== TASK_ARTIFACT_MANIFEST_SCHEMA) {
		issues.push("proof must include task artifact evidence for consumers");
	}
	return { ok: issues.length === 0, issues };
}

export function buildTaskArtifactManifest(report) {
	return {
		schema: TASK_ARTIFACT_MANIFEST_SCHEMA,
		taskId: TASK_ID,
		effortId: EFFORT_ID,
		createdAt: ISSUED_AT,
		artifacts: [
			{
				id: "toolless-orchestrator-proof",
				uri: "proof.json",
				mediaType: "application/json",
				role: "audit-trail",
				hash: sha256Json(report),
				reviewState: "accepted",
				labels: [
					"toolless-orchestrator",
					"conductor",
					"keyless-actor",
					"claim-promotion",
				],
				provenance: {
					runId: RUN_ID,
					producer: "toolless-orchestrator:proof",
					command: "node validations/toolless-orchestrator-proof/toolless-orchestrator-proof.mjs",
					process: {
						command: "node",
						args: ["validations/toolless-orchestrator-proof/toolless-orchestrator-proof.mjs"],
						display: "node validations/toolless-orchestrator-proof/toolless-orchestrator-proof.mjs",
					},
					source: "validations/toolless-orchestrator-proof",
					sourceVersion: "synthetic-v1",
					producedAt: ISSUED_AT,
					inputHashes: [
						report.sourceTruth.hash,
						report.evidence.rawEvidence.hash,
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
	console.log(JSON.stringify(buildToollessOrchestratorProof(), null, 2));
}
