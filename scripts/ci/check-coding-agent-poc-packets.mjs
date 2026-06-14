#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	findTaskArtifactById,
	isTaskArtifactManifest,
} from "../../packages/artifact-contract-v1/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURE_DIR = path.join(
	ROOT,
	"validations",
	"extension-sandbox-poc",
	"fixtures",
	"expected",
);

function readJson(fileName) {
	return JSON.parse(readFileSync(path.join(FIXTURE_DIR, fileName), "utf8"));
}

const smoke = readJson("coding-agent-smoke.json");
const evidence = readJson("coding-agent-evidence.json");
const rehearsal = readJson("coding-agent-temp-workspace.json");
const manifest = readJson("task-artifacts.json");

assert.equal(isTaskArtifactManifest(manifest), true);

const smokeArtifact = findTaskArtifactById(manifest, "coding-agent-smoke-json");
assert.ok(smokeArtifact, "coding-agent-smoke-json must be published");
assert.equal(smokeArtifact.role, "receipt");
assert.equal(smokeArtifact.reviewState, "accepted");
assert.equal(smokeArtifact.mediaType, "application/json");
assert.ok(smokeArtifact.labels.includes("coding-agent"));
assert.ok(smokeArtifact.labels.includes("smoke"));
assert.ok(smokeArtifact.labels.includes("review-packet"));
assert.ok(smokeArtifact.labels.includes("denied-capability"));
assert.ok(smokeArtifact.labels.includes("claim-promotion"));
assert.ok(smokeArtifact.labels.includes("theme-1"));

assert.equal(smoke.mode, "proposal-only");
assert.equal(smoke.claimStatus, "deterministic-smoke");
assert.equal(smoke.input.taskId, evidence.controlledRun.taskId);
assert.deepEqual(smoke.input.grantedCapabilities, evidence.capabilityModel.autoAllowed);
assert.deepEqual(
	smoke.input.requestedCapabilities,
	evidence.capabilityModel.requestedByAgent,
);

assert.equal(smoke.outputs.proposedPatch.format, "unified-diff");
assert.equal(smoke.outputs.proposedPatch.mutatesWorkspace, false);
assert.match(smoke.outputs.proposedPatch.targetPath, /^validations\/extension-sandbox-poc\//);
assert.match(smoke.outputs.proposedPatch.diff, /^--- a\//);
assert.equal(smoke.observedWrites.length, 0);

assert.equal(smoke.outputs.reviewPacket.status, "requires-operator-review");
assert.deepEqual(smoke.outputs.reviewPacket.requiredBeforePromotion, [
	"workspace:write",
	"process:run",
]);
assert.ok(
	smoke.outputs.reviewPacket.primaryEvidence.includes("coding-agent-evidence.json"),
);
assert.ok(smoke.outputs.reviewPacket.primaryEvidence.includes("policy-decision.json"));
assert.ok(smoke.outputs.reviewPacket.primaryEvidence.includes("limits.md"));

assert.equal(smoke.outputs.deniedCapabilityReceipt.capability, "network:v1");
assert.equal(smoke.outputs.deniedCapabilityReceipt.status, "denied");
assert.ok(
	smoke.outputs.deniedCapabilityReceipt.evidence.includes("policy-decision.json"),
);
assert.ok(
	smoke.outputs.deniedCapabilityReceipt.evidence.includes("sandbox-report.json"),
);

assert.deepEqual(smoke.protectedSurfaceTouches, []);
for (const protectedSurface of smoke.protectedSurfaces) {
	assert.match(protectedSurface, /\*\*$/);
}
assert.equal(smoke.checks.proposedPatchRecorded, true);
assert.equal(smoke.checks.deniedCapabilityReceiptRecorded, true);
assert.equal(smoke.checks.operatorReviewRequired, true);
assert.equal(smoke.checks.protectedSurfacesUntouched, true);

assert.match(smoke.promotionBoundary.canSay, /evidence packet shape/);
assert.match(smoke.promotionBoundary.cannotSay, /real model-driven coding agent/);
assert.match(smoke.nextPromotion, /temporary workspace/);

const rehearsalArtifact = findTaskArtifactById(
	manifest,
	"coding-agent-temp-workspace-json",
);
assert.ok(rehearsalArtifact, "coding-agent-temp-workspace-json must be published");
assert.equal(rehearsalArtifact.role, "receipt");
assert.equal(rehearsalArtifact.reviewState, "accepted");
assert.ok(rehearsalArtifact.labels.includes("coding-agent"));
assert.ok(rehearsalArtifact.labels.includes("temporary-workspace"));
assert.ok(rehearsalArtifact.labels.includes("review-packet"));
assert.ok(rehearsalArtifact.labels.includes("claim-promotion"));
assert.ok(rehearsalArtifact.labels.includes("theme-1"));

assert.equal(rehearsal.mode, "temporary-workspace-copy");
assert.equal(rehearsal.workspace.repositoryMutationAllowed, false);
assert.equal(rehearsal.workspace.workspaceMutationAllowed, true);
assert.equal(rehearsal.input.sourceSmoke, "coding-agent-smoke.json");
assert.equal(rehearsal.input.proposedPatchId, smoke.outputs.proposedPatch.id);
assert.deepEqual(
	rehearsal.reviewPacket.requiredBeforePromotion,
	smoke.outputs.reviewPacket.requiredBeforePromotion,
);
assert.ok(
	rehearsal.receipts.some(
		(receipt) =>
			receipt.capability === "network:v1" && receipt.status === "denied",
	),
);
assert.ok(
	rehearsal.receipts.some(
		(receipt) =>
			receipt.capability === "repository:write" && receipt.status === "denied",
	),
);
assert.deepEqual(rehearsal.observedRepositoryWrites, []);
assert.deepEqual(rehearsal.protectedSurfaceTouches, []);
assert.equal(rehearsal.checks.tempWorkspaceUsed, true);
assert.equal(rehearsal.checks.repositoryMutationBlocked, true);
assert.equal(rehearsal.checks.reviewPacketPreserved, true);
assert.equal(rehearsal.checks.deniedCapabilityReceiptPreserved, true);
assert.equal(rehearsal.checks.protectedSurfacesUntouched, true);
assert.equal(rehearsal.checks.fileHashChangedOnlyInsideTempWorkspace, true);
assert.match(rehearsal.promotionBoundary.cannotSay, /real model-driven coding agent/);

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "refarm-coding-agent-rehearsal-"));
try {
	const targetPath = path.join(tempRoot, rehearsal.workspace.targetPath);
	mkdirSync(path.dirname(targetPath), { recursive: true });
	writeFileSync(targetPath, rehearsal.fileState.before);
	assert.equal(readFileSync(targetPath, "utf8"), rehearsal.fileState.before);
	writeFileSync(targetPath, rehearsal.fileState.after);
	assert.equal(readFileSync(targetPath, "utf8"), rehearsal.fileState.after);
	assert.equal(
		rehearsal.fileState.after.includes("reviewRequired"),
		true,
		"temporary workspace rehearsal must apply the reviewed change",
	);
} finally {
	rmSync(tempRoot, { force: true, recursive: true });
}

console.log("Validated coding-agent POC packet invariants and temp rehearsal.");
