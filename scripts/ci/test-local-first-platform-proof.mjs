import assert from "node:assert/strict";
import test from "node:test";
import {
	buildLocalFirstPlatformProof,
	parseLocalFirstPlatformProofArgs,
	REQUIRED_T2_PACKAGES,
	REQUIRED_WALLET_ARTIFACTS,
} from "./local-first-platform-proof.mjs";

test("parses local-first platform proof options", () => {
	assert.deepEqual(
		parseLocalFirstPlatformProofArgs(["--selection", "consumer-ready", "--", "--json"]),
		{
			selectionId: "consumer-ready",
			json: true,
		},
	);
});

test("proves the T2 local-first platform packet without binding provider UX", async () => {
	const proof = await buildLocalFirstPlatformProof({
		env: { REFARM_PACKAGE_MANAGER: "pnpm" },
		selectionId: "consumer-ready",
	});

	assert.equal(proof.schemaVersion, 1);
	assert.equal(proof.command, "local-first-platform-proof");
	assert.equal(proof.ok, true, proof.failures.join("\n"));
	assert.equal(proof.track, "T2");
	assert.equal(proof.claimStatus, "deterministic-composition-proof");
	assert.deepEqual(
		proof.selectedPackages.map((entry) => entry.package),
		REQUIRED_T2_PACKAGES,
	);
	assert.equal(proof.selectedPackages.every((entry) => entry.selected), true);
	assert.deepEqual(
		proof.walletEvidence.requiredArtifacts.map((entry) => entry.id),
		REQUIRED_WALLET_ARTIFACTS,
	);
	assert.equal(proof.walletEvidence.requiredArtifacts.every((entry) => entry.present), true);
	assert.equal(proof.walletEvidence.authorization.status, "active");
	assert.equal(proof.walletEvidence.presentation.presentedAttributeCount, 2);
	assert.deepEqual(proof.walletEvidence.revocation, {
		authorizationId: "authz-sintetica-001",
		statusBefore: "active",
		statusAfter: "revoked",
	});
	assert.equal(proof.localSurface.manifest.schema, "local-surface.v1");
	assert.equal(proof.localSurface.manifest.localFirst.networkRequired, false);
	assert.deepEqual(proof.localSurface.launchPlan.steps.map((step) => step.id), [
		"doctor",
		"render",
		"serve",
		"handoff",
	]);
	assert.equal(proof.localSurface.html.rendered, true);
	assert.equal(proof.localSurface.html.containsLocalSurfaceMarker, true);
	assert.deepEqual(proof.localSurface.qualityReport.findings, []);
	assert.deepEqual(
		proof.acceptanceCoverage.map((entry) => entry.status),
		["proven", "proven", "proven", "proven", "bounded"],
	);
	assert.deepEqual(proof.failures, []);
});
