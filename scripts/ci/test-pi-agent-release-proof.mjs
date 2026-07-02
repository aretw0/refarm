import assert from "node:assert/strict";
import test from "node:test";
import {
	buildPiAgentReleaseProof,
	parsePiAgentReleaseProofArgs,
} from "./pi-agent-release-proof.mjs";

test("parses pi-agent release proof options", () => {
	assert.deepEqual(parsePiAgentReleaseProofArgs(["--", "--json"]), { json: true });
});

test("proves pi-agent can be released as a narrow runtime-engine package", () => {
	const proof = buildPiAgentReleaseProof();

	assert.equal(proof.schemaVersion, 1);
	assert.equal(proof.command, "pi-agent-release-proof");
	assert.equal(proof.ok, true, proof.failures.join("\n"));
	assert.equal(proof.packageName, "@refarm.dev/pi-agent");
	assert.equal(proof.version, "0.1.0");
	assert.equal(proof.publicationBoundary.access, "public");
	assert.deepEqual(proof.publicationBoundary.files, [
		"dist/pi_agent.wasm",
		"dist/plugin.json",
		"dist/jco",
	]);
	assert.equal(proof.publicationBoundary.pluginId, "@refarm/pi-agent");
	assert.equal(proof.requiredScripts.every((entry) => entry.present), true);
	assert.equal(proof.readmeMarkers.every((entry) => entry.present), true);
	assert.deepEqual(proof.failures, []);
});
