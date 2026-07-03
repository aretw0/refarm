import assert from "node:assert/strict";
import test from "node:test";
import {
	buildAgentDemoReleaseProof,
	HELD_AGENT_PLUGIN_SURFACES,
	parseAgentDemoReleaseProofArgs,
	REQUIRED_EVIDENCE_ARTIFACTS,
	REQUIRED_PUBLIC_PACKAGES,
} from "./agent-demo-release-proof.mjs";

test("parses agent-demo release proof options", () => {
	assert.deepEqual(
		parseAgentDemoReleaseProofArgs(["--selection", "vault-seed-ready", "--", "--json"]),
		{
			selectionId: "vault-seed-ready",
			json: true,
		},
	);
});

test("proves the agent-demo public surface without publishing held plugin runtime packages", () => {
	const proof = buildAgentDemoReleaseProof({
		env: { REFARM_PACKAGE_MANAGER: "pnpm" },
		selectionId: "vault-seed-ready",
	});

	assert.equal(proof.ok, true);
	assert.equal(proof.selectionId, "vault-seed-ready");
	assert.deepEqual(
		proof.publicSurface.map((entry) => entry.package),
		REQUIRED_PUBLIC_PACKAGES,
	);
	assert.equal(proof.publicSurface.every((entry) => entry.selected), true);
	assert.match(proof.engineProof, /agent:release-proof/);
	assert.deepEqual(
		proof.heldSurfaces.map((entry) => entry.id),
		HELD_AGENT_PLUGIN_SURFACES.map((entry) => entry.id),
	);
	assert.equal(proof.heldSurfaces.every((entry) => !entry.selected), true);
	assert.deepEqual(
		proof.evidence.map((entry) => entry.id),
		REQUIRED_EVIDENCE_ARTIFACTS,
	);
	assert.equal(proof.evidence.every((entry) => entry.present), true);
	assert.equal(proof.evidence.every((entry) => entry.reviewState === "accepted"), true);
	assert.deepEqual(proof.failures, {
		missingPublicPackages: [],
		selectedHeldSurfaces: [],
		missingEvidenceArtifacts: [],
	});
});
