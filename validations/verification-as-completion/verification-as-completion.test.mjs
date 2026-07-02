import test from "node:test";
import assert from "node:assert/strict";
import { validateTaskArtifactManifest } from "../../packages/artifact-contract-v1/dist/index.js";
import {
	buildCompletionDecision,
	buildSourceTruth,
	buildToolObservation,
	buildVerificationAsCompletionProof,
	buildVerificationEvidence,
	validateVerificationAsCompletionProof,
} from "./verification-as-completion.mjs";

test("verification-as-completion proof completes only with source evidence", () => {
	const proof = buildVerificationAsCompletionProof();
	const validation = validateVerificationAsCompletionProof(proof);

	assert.equal(validation.ok, true, validation.issues.join("\n"));
	assert.equal(proof.completion.state, "completed");
	assert.equal(proof.completion.verificationOk, true);
	assert.equal(proof.observation.policy.compactViewIsTruth, false);
	assert.equal(proof.observation.compactView.rawEvidenceRecoverable, true);
	assert.equal(proof.verification.checks.every((check) => check.ok), true);
	const artifactManifestValidation = validateTaskArtifactManifest(proof.artifactManifest);
	assert.equal(artifactManifestValidation.ok, true, artifactManifestValidation.issues.join("\n"));
	assert.equal(proof.artifactManifest.artifacts[0].provenance.command, "pnpm run verification-completion:poc:test");
});

test("completion is blocked when the observed source hash drifts", () => {
	const sourceTruth = buildSourceTruth();
	const observation = buildToolObservation(sourceTruth);
	const tamperedObservation = {
		...observation,
		observed: {
			...observation.observed,
			hash: {
				algorithm: "sha256",
				value: "0".repeat(64),
			},
		},
	};
	const verification = buildVerificationEvidence({
		sourceTruth,
		observation: tamperedObservation,
	});
	const completion = buildCompletionDecision({
		observation: tamperedObservation,
		verification,
	});

	assert.equal(verification.checks.find((check) => check.id === "source-hash-matches").ok, false);
	assert.equal(completion.state, "blocked");
	assert.equal(completion.verificationOk, false);
});

test("tool-less delegation keeps keys and tools in separate actors", () => {
	const proof = buildVerificationAsCompletionProof();
	const delegation = proof.toollessDelegation;

	assert.equal(delegation.orchestrator.holdsOperatorKeys, true);
	assert.deepEqual(delegation.orchestrator.toolCapabilities, []);
	assert.equal(delegation.actor.keyless, true);
	assert.equal(delegation.actor.holdsOperatorKeys, false);
	assert.ok(delegation.actor.toolCapabilities.includes("source-read"));
	assert.equal(delegation.boundary.orchestratorOwnsTools, false);
	assert.equal(delegation.boundary.actorCanEscalateKeys, false);
});

test("context map points at context:v1 without claiming a new package", () => {
	const proof = buildVerificationAsCompletionProof();
	const context = proof.contextMap;

	assert.equal(context.capability, "context:v1");
	assert.equal(context.home, "@refarm.dev/context-provider-v1");
	assert.equal(context.reversibleFold.enabled, true);
	assert.ok(context.reversibleFold.protectedTailEntryRefs.includes("turn:current-proof"));
	assert.equal(proof.boundary.packageExtraction, false);
	assert.equal(proof.boundary.publicApi, false);
});
