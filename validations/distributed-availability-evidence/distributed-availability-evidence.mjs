import { createHash } from "node:crypto";
import { TASK_ARTIFACT_MANIFEST_SCHEMA } from "../../packages/artifact-contract-v1/dist/index.js";
import {
	buildReleasePlan,
	createReleasePlanAuditRecord,
} from "../../packages/release-engine/src/index.mjs";

export const ISSUED_AT = "2026-06-30T00:00:00.000Z";
export const TASK_ID = "task-distributed-availability-evidence-proof";
export const EFFORT_ID = "effort-distributed-availability-evidence-proof-001";
export const RUN_ID = "distributed-availability-evidence-proof-001";
export const PROOF_SCHEMA = "refarm.distributed-availability.proof.v1";
export const DISTRIBUTION_REF = "refarm-proof://distributions/refarm-core-blocks";

export function buildDistributionIdentity() {
	return {
		schema: "refarm.distribution-identity.proof.v1",
		distributionId: "refarm-core-blocks-proof",
		stableRef: DISTRIBUTION_REF,
		subject: {
			kind: "package-selection",
			id: "refarm-core-blocks",
			packages: ["@refarm.dev/artifact-contract-v1"],
		},
		version: {
			channel: "proof",
			line: "local-proof",
			current: "2026.06.30-proof.1",
			previous: "2026.06.29-proof.1",
		},
	};
}

export function buildAvailabilityPolicy() {
	return {
		schema: "refarm.availability-policy.proof.v1",
		minAvailableCopies: 2,
		offlineBehavior: "degraded-read-only",
		retention: {
			keepCurrent: true,
			keepRollbackTarget: true,
			garbageCollectUnreferencedProofs: true,
		},
		actors: [
			{
				id: "operator-workstation",
				role: "primary-seed",
				required: true,
				transportFixture: "local-cache",
			},
			{
				id: "blind-cache-fixture",
				role: "blind-replica",
				required: false,
				transportFixture: "artifact-cache",
			},
		],
		remoteNodeEvidence: {
			schema: "refarm.remote-workspace-node.proof.v1",
			nodeId: "home-workstation",
			workspaceMode: "read-only",
			environmentCeilingRequired: true,
		},
	};
}

export function buildUpdateAndRollbackEvidence(identity = buildDistributionIdentity()) {
	return {
		schema: "refarm.update-rollback-evidence.proof.v1",
		update: {
			source: "release-engine",
			channel: identity.version.channel,
			currentVersion: identity.version.current,
			strategy: "staged-promotion",
			requiresHumanApproval: true,
			evidenceRefs: ["release-plan-audit-record", "task-artifact-manifest"],
		},
		rollback: {
			targetVersion: identity.version.previous,
			strategy: "previous-version-retained",
			requiresHumanApproval: true,
			evidenceRefs: ["task-artifact-manifest"],
		},
	};
}

export function buildReleaseTrustEvidence() {
	const plan = buildReleasePlan({
		packageNames: ["@refarm.dev/artifact-contract-v1"],
		dryRun: true,
	});
	const auditRecord = createReleasePlanAuditRecord(plan, { createdAt: ISSUED_AT });
	return {
		schema: "refarm.release-trust-evidence.proof.v1",
		releaseAuditRecord: auditRecord,
		acceptedPackages: plan.orderedNames,
		requiredGates: plan.gates.filter((gate) => gate.required).map((gate) => gate.id),
		note: "Proof fixture only; not a publish selection or install contract.",
	};
}

export function buildDistributedAvailabilityProof() {
	const identity = buildDistributionIdentity();
	const availability = buildAvailabilityPolicy();
	const updateAndRollback = buildUpdateAndRollbackEvidence(identity);
	const trust = buildReleaseTrustEvidence();
	const report = {
		schema: PROOF_SCHEMA,
		createdAt: ISSUED_AT,
		identity,
		availability,
		updateAndRollback,
		trust,
		boundary: {
			packageExtraction: false,
			appOwnedContract: false,
			productReady: false,
			p2pSubstrateAdopted: false,
			bareRuntimeAdopted: false,
			hypercoreFamilyAdopted: false,
			pearRuntimeAdopted: false,
			canonicalProtocol: "none-proof-local",
			candidateSubstrates: ["tractor", "source:v1", "artifact-contract-v1", "release-engine"],
		},
	};
	return {
		...report,
		artifactManifest: buildTaskArtifactManifest(report),
	};
}

export function validateDistributedAvailabilityProof(proof) {
	const issues = [];
	if (proof?.schema !== PROOF_SCHEMA) {
		issues.push("proof schema must stay proof-local");
	}
	if (!proof?.identity?.stableRef?.startsWith("refarm-proof://")) {
		issues.push("stableRef must use the proof-local refarm-proof scheme");
	}
	if (!Array.isArray(proof?.identity?.subject?.packages) || proof.identity.subject.packages.length === 0) {
		issues.push("distribution identity must name at least one package subject");
	}
	if (!Array.isArray(proof?.availability?.actors) || proof.availability.actors.length === 0) {
		issues.push("availability policy must name actors");
	}
	const actorRoles = new Set((proof?.availability?.actors || []).map((actor) => actor.role));
	if (!actorRoles.has("primary-seed")) {
		issues.push("availability policy must include a primary seed");
	}
	if (!actorRoles.has("blind-replica")) {
		issues.push("availability policy must include a replica fixture");
	}
	if (proof?.availability?.minAvailableCopies < 2) {
		issues.push("availability policy must require at least two available copies");
	}
	if (!proof?.updateAndRollback?.update?.currentVersion) {
		issues.push("update evidence must name the current version");
	}
	if (!proof?.updateAndRollback?.rollback?.targetVersion) {
		issues.push("rollback evidence must name a rollback target version");
	}
	if (proof?.updateAndRollback?.update?.currentVersion === proof?.updateAndRollback?.rollback?.targetVersion) {
		issues.push("rollback target must differ from current version");
	}
	if (proof?.trust?.releaseAuditRecord?.digest?.algorithm !== "sha256") {
		issues.push("trust evidence must include a sha256 release audit digest");
	}
	if (proof?.boundary?.packageExtraction !== false) {
		issues.push("first proof must not extract a public package");
	}
	if (proof?.boundary?.appOwnedContract !== false) {
		issues.push("first proof must not be app-owned");
	}
	for (const field of ["p2pSubstrateAdopted", "bareRuntimeAdopted", "hypercoreFamilyAdopted", "pearRuntimeAdopted"]) {
		if (proof?.boundary?.[field] !== false) {
			issues.push(`${field} must remain false in this proof`);
		}
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
				id: "distributed-availability-evidence-proof",
				uri: "distributed-availability-evidence-proof.json",
				mediaType: "application/json",
				role: "manifest",
				hash: {
					algorithm: "sha256",
					value: hash,
				},
				reviewState: "unreviewed",
				labels: ["distributed-availability", "distribution", "proof"],
				provenance: {
					runId: RUN_ID,
					producer: "distributed-availability-evidence:proof",
					command: "pnpm run distributed-availability:poc:test",
					source: "validations/distributed-availability-evidence",
					producedAt: ISSUED_AT,
					inputHashes: [report.trust.releaseAuditRecord.digest],
				},
			},
		],
	};
}

function sha256Json(value) {
	return createHash("sha256")
		.update(`${JSON.stringify(value, null, 2)}\n`)
		.digest("hex");
}
