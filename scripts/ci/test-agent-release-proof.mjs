import assert from "node:assert/strict";
import test from "node:test";
import {
	buildAgentReleaseProof,
	parseAgentReleaseProofArgs,
} from "./agent-release-proof.mjs";

test("parses agent release proof options", () => {
	assert.deepEqual(parseAgentReleaseProofArgs(["--", "--json"]), { json: true });
});

test("proves agent can be released as a narrow runtime-engine package", () => {
	const proof = buildAgentReleaseProof();

	assert.equal(proof.schemaVersion, 1);
	assert.equal(proof.command, "agent-release-proof");
	assert.equal(proof.ok, true, proof.failures.join("\n"));
	assert.equal(proof.packageName, "@refarm.dev/agent");
	assert.equal(proof.version, "0.1.0");
	assert.equal(proof.publicationBoundary.access, "public");
	assert.deepEqual(proof.publicationBoundary.files, [
		"dist/agent.wasm",
		"dist/plugin.json",
		"dist/jco",
	]);
	assert.equal(proof.publicationBoundary.pluginId, "@refarm/agent");
	assert.equal(proof.requiredScripts.every((entry) => entry.present), true);
	assert.equal(proof.readmeMarkers.every((entry) => entry.present), true);
	assert.deepEqual(proof.failures, []);
});
