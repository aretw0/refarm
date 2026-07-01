import assert from "node:assert/strict";
import test from "node:test";
import {
	buildActor,
	buildConductor,
	buildConductorDecision,
	buildDelegationRequest,
	buildSourceTruth,
	buildToollessOrchestratorProof,
	validateToollessOrchestratorProof,
} from "./toolless-orchestrator-proof.mjs";

test("tool-less orchestrator completes with keyless bounded actor evidence", () => {
	const proof = buildToollessOrchestratorProof();
	const validation = validateToollessOrchestratorProof(proof);

	assert.equal(validation.ok, true, validation.issues.join("\n"));
	assert.equal(proof.conductor.holdsOperatorKeys, true);
	assert.deepEqual(proof.conductor.environmentToolCapabilities, []);
	assert.equal(proof.actor.keyless, true);
	assert.equal(proof.actor.holdsOperatorKeys, false);
	assert.ok(proof.actor.environmentToolCapabilities.includes("source-read"));
	assert.equal(proof.request.secretMaterialProvided, false);
	assert.equal(proof.evidence.compactView.compactViewIsTruth, false);
	assert.equal(proof.evidence.compactView.rawEvidenceRecoverable, true);
	assert.equal(proof.decision.state, "completed");
});

test("conductor blocks if it owns environment tools", () => {
	const sourceTruth = buildSourceTruth();
	const conductor = buildConductor({ environmentToolCapabilities: ["source-read"] });
	const actor = buildActor();
	const request = buildDelegationRequest({ sourceTruth });
	const decision = buildConductorDecision({ conductor, actor, sourceTruth, request });
	const failed = decision.checks.find((check) => check.id === "conductor-has-no-environment-tools");

	assert.equal(failed.ok, false);
	assert.equal(decision.state, "blocked");
});

test("conductor blocks unbounded requested capabilities", () => {
	const sourceTruth = buildSourceTruth();
	const actor = buildActor();
	const request = buildDelegationRequest({
		sourceTruth,
		requestedCapabilities: ["source-read", "network-egress"],
	});
	const decision = buildConductorDecision({ actor, sourceTruth, request });
	const failed = decision.checks.find((check) => check.id === "requested-capabilities-are-actor-bounded");

	assert.equal(failed.ok, false);
	assert.equal(decision.state, "blocked");
});

test("conductor blocks delegation that carries secret material", () => {
	const sourceTruth = buildSourceTruth();
	const request = buildDelegationRequest({ sourceTruth, secretMaterialProvided: true });
	const decision = buildConductorDecision({ sourceTruth, request });
	const failed = decision.checks.find((check) => check.id === "request-carries-no-secret-material");

	assert.equal(failed.ok, false);
	assert.equal(decision.state, "blocked");
});

test("boundary stays proof-local and outside app-owned policy", () => {
	const proof = buildToollessOrchestratorProof();

	assert.equal(proof.boundary.packageExtraction, false);
	assert.equal(proof.boundary.runtimeMutation, false);
	assert.equal(proof.boundary.appOwnedPolicy, false);
	assert.equal(proof.boundary.globalShellProxy, false);
	assert.ok(proof.boundary.candidateHomes.includes("process-handoff"));
});
