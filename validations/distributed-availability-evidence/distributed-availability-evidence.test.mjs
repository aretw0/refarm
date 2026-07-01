import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateTaskArtifactManifest } from "../../packages/artifact-contract-v1/dist/index.js";
import {
	DISTRIBUTION_REF,
	PROOF_SCHEMA,
	buildAvailabilityPolicy,
	buildDistributedAvailabilityProof,
	buildDistributionIdentity,
	buildReleaseTrustEvidence,
	buildUpdateAndRollbackEvidence,
	validateDistributedAvailabilityProof,
} from "./distributed-availability-evidence.mjs";

describe("distributed availability evidence proof", () => {
	it("keeps identity stable and proof-local", () => {
		const identity = buildDistributionIdentity();

		assert.equal(identity.stableRef, DISTRIBUTION_REF);
		assert.equal(identity.stableRef.startsWith("refarm-proof://"), true);
		assert.equal(identity.stableRef.includes("pear://"), false);
		assert.equal(identity.subject.kind, "package-selection");
		assert.deepEqual(identity.subject.packages, ["@refarm.dev/artifact-contract-v1"]);
		assert.equal(identity.version.current, "2026.06.30-proof.1");
		assert.equal(identity.version.previous, "2026.06.29-proof.1");
	});

	it("requires explicit availability actors and read-only remote node evidence", () => {
		const availability = buildAvailabilityPolicy();

		assert.equal(availability.minAvailableCopies, 2);
		assert.equal(availability.offlineBehavior, "degraded-read-only");
		assert.deepEqual(
			availability.actors.map((actor) => [actor.id, actor.role, actor.required]),
			[
				["operator-workstation", "primary-seed", true],
				["blind-cache-fixture", "blind-replica", false],
			],
		);
		assert.equal(availability.remoteNodeEvidence.schema, "refarm.remote-workspace-node.proof.v1");
		assert.equal(availability.remoteNodeEvidence.workspaceMode, "read-only");
		assert.equal(availability.remoteNodeEvidence.environmentCeilingRequired, true);
	});

	it("models update and rollback as release evidence, not as a runtime rewrite", () => {
		const updateAndRollback = buildUpdateAndRollbackEvidence();

		assert.equal(updateAndRollback.update.source, "release-engine");
		assert.equal(updateAndRollback.update.currentVersion, "2026.06.30-proof.1");
		assert.equal(updateAndRollback.rollback.targetVersion, "2026.06.29-proof.1");
		assert.notEqual(
			updateAndRollback.update.currentVersion,
			updateAndRollback.rollback.targetVersion,
		);
		assert.deepEqual(updateAndRollback.update.evidenceRefs, [
			"release-plan-audit-record",
			"task-artifact-manifest",
		]);
	});

	it("composes release-engine trust evidence without making it a publish selection", () => {
		const trust = buildReleaseTrustEvidence();

		assert.equal(trust.releaseAuditRecord.schemaVersion, 1);
		assert.equal(trust.releaseAuditRecord.digest.algorithm, "sha256");
		assert.match(trust.releaseAuditRecord.digest.value, /^[a-f0-9]{64}$/);
		assert.deepEqual(trust.acceptedPackages, ["@refarm.dev/artifact-contract-v1"]);
		assert.equal(trust.note.includes("not a publish selection"), true);
	});

	it("emits artifact evidence and keeps substrate adoption explicitly false", () => {
		const proof = buildDistributedAvailabilityProof();
		const validation = validateDistributedAvailabilityProof(proof);
		const artifactValidation = validateTaskArtifactManifest(proof.artifactManifest);

		assert.equal(proof.schema, PROOF_SCHEMA);
		assert.deepEqual(validation, { ok: true, issues: [] });
		assert.deepEqual(artifactValidation, { ok: true, issues: [] });
		assert.equal(proof.boundary.packageExtraction, false);
		assert.equal(proof.boundary.appOwnedContract, false);
		assert.equal(proof.boundary.productReady, false);
		assert.equal(proof.boundary.p2pSubstrateAdopted, false);
		assert.equal(proof.boundary.bareRuntimeAdopted, false);
		assert.equal(proof.boundary.hypercoreFamilyAdopted, false);
		assert.equal(proof.boundary.pearRuntimeAdopted, false);
		assert.equal(proof.artifactManifest.artifacts[0].role, "manifest");
		assert.deepEqual(proof.artifactManifest.artifacts[0].labels, [
			"distributed-availability",
			"distribution",
			"proof",
		]);
		assert.deepEqual(proof.artifactManifest.artifacts[0].provenance.inputHashes, [
			proof.trust.releaseAuditRecord.digest,
		]);
	});

	it("refuses claims without rollback target or replica evidence", () => {
		const proof = buildDistributedAvailabilityProof();
		const invalid = {
			...proof,
			availability: {
				...proof.availability,
				minAvailableCopies: 1,
				actors: proof.availability.actors.filter((actor) => actor.role !== "blind-replica"),
			},
			updateAndRollback: {
				...proof.updateAndRollback,
				rollback: {
					...proof.updateAndRollback.rollback,
					targetVersion: "",
				},
			},
		};
		const validation = validateDistributedAvailabilityProof(invalid);

		assert.equal(validation.ok, false);
		assert.deepEqual(validation.issues, [
			"availability policy must include a replica fixture",
			"availability policy must require at least two available copies",
			"rollback evidence must name a rollback target version",
		]);
	});
});
