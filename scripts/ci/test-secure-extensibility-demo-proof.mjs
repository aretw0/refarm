import assert from "node:assert/strict";
import test from "node:test";
import {
	buildSecureExtensibilityDemoProof,
	parseSecureExtensibilityDemoProofArgs,
	REQUIRED_T1_ARTIFACTS,
	REQUIRED_WHITE_LABEL_STEPS,
} from "./secure-extensibility-demo-proof.mjs";

test("parses secure-extensibility proof options", () => {
	assert.deepEqual(
		parseSecureExtensibilityDemoProofArgs(["--selection", "vault-seed-ready", "--", "--json"]),
		{
			selectionId: "vault-seed-ready",
			json: true,
		},
	);
});

test("proves the T1 secure-extensibility demo packet without widening runtime claims", () => {
	const proof = buildSecureExtensibilityDemoProof({
		env: { REFARM_PACKAGE_MANAGER: "pnpm" },
		selectionId: "vault-seed-ready",
	});

	assert.equal(proof.schemaVersion, 1);
	assert.equal(proof.command, "secure-extensibility-demo-proof");
	assert.equal(proof.ok, true, proof.failures.join("\n"));
	assert.equal(proof.track, "T1");
	assert.equal(proof.claimStatus, "deterministic-composition-proof");
	assert.deepEqual(
		proof.whiteLabelCommandEnvelope.map((entry) => entry.step),
		REQUIRED_WHITE_LABEL_STEPS,
	);
	assert.equal(proof.reviewPacket.schema, "refarm.extension-install-review-packet.v1");
	assert.equal(proof.reviewPacket.installMode, "review-first");
	assert.equal(proof.reviewPacket.readyToInstall, false);
	assert.equal(proof.reviewPacket.deniedCapabilityReceiptCount > 0, true);
	assert.equal(proof.qualityGate.ready, true);
	assert.equal(proof.qualityGate.commandStepPresent, true);
	assert.equal(proof.qualityGate.gate, "continue");
	assert.equal(proof.publicSurface.every((entry) => entry.selected), true);
	assert.equal(proof.heldSurfaces.every((entry) => !entry.selected), true);
	assert.deepEqual(
		proof.requiredArtifacts.map((entry) => entry.id),
		REQUIRED_T1_ARTIFACTS,
	);
	assert.equal(proof.requiredArtifacts.every((entry) => entry.present), true);
	assert.deepEqual(
		proof.acceptanceCoverage.map((entry) => entry.status),
		["proven", "proven", "proven", "proven", "proven", "bounded", "bounded"],
	);
	assert.deepEqual(proof.failures, []);
});
