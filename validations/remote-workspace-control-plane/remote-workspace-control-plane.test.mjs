import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateTaskArtifactManifest } from "../../packages/artifact-contract-v1/dist/index.js";
import {
	buildBoundedReadOnlyEffort,
	buildCancelDecision,
	buildRemoteNodeDescriptor,
	buildRemoteNodeStatus,
	buildRemoteWorkspaceControlProof,
	buildStreamTranscript,
	validateRemoteNodeDescriptor,
	PROOF_SCHEMA,
	STREAM_REF,
} from "./remote-workspace-control-plane.mjs";

describe("remote workspace control plane proof", () => {
	it("keeps the remote node descriptor proof-local and read-only", () => {
		const descriptor = buildRemoteNodeDescriptor();

		assert.equal(descriptor.schema, PROOF_SCHEMA);
		assert.equal(descriptor.transport.kind, "loopback");
		assert.equal(descriptor.workspace.mode, "read-only");
		assert.equal(descriptor.policy.rawShell, false);
		assert.equal(descriptor.policy.mutation, false);
		assert.deepEqual(validateRemoteNodeDescriptor(descriptor), { ok: true, issues: [] });
	});

	it("reports readiness, allowed operations, and refused operations before dispatch", () => {
		const status = buildRemoteNodeStatus();

		assert.equal(status.schema, "refarm.remote-workspace-status.proof.v1");
		assert.equal(status.runtime.ready, true);
		assert.equal(status.environmentPressure.decision, "continue");
		assert.deepEqual(status.allowedOperations, [
			"status",
			"bounded-read-only-process",
			"stream",
			"cancel",
			"artifact-evidence",
		]);
		assert.deepEqual(
			status.refusedOperations.map((item) => item.operation),
			["raw-shell", "mutation"],
		);
		assert.match(status.refusedOperations[0].reason, /elevated capability/);
	});

	it("plans the bounded read-only command through process-handoff", () => {
		const effort = buildBoundedReadOnlyEffort();

		assert.equal(effort.policyDecision.state, "allowed");
		assert.equal(effort.process.command, "refarm");
		assert.deepEqual(effort.process.args, ["check", "--next-action", "--json"]);
		assert.equal(effort.process.cwd, "/workspaces/refarm");
		assert.equal(effort.process.display, "refarm check --next-action --json");
		assert.equal(effort.process.packageManager, null);
	});

	it("uses stream-contract shaped chunks and explicit cancel states", () => {
		const stream = buildStreamTranscript();

		assert.equal(stream.capability, "stream:v1");
		assert.equal(stream.streamRef, STREAM_REF);
		assert.deepEqual(
			stream.chunks.map((chunk) => [chunk.sequence, chunk.is_final, chunk.payload_kind]),
			[
				[0, false, "text_delta"],
				[1, true, "final_text"],
			],
		);
		assert.equal(stream.chunks[1].metadata.exitCode, 0);
		assert.equal(buildCancelDecision().state, "already-complete");
		assert.match(buildCancelDecision({ state: "refused-by-policy" }).reason, /policy refused/);
	});

	it("emits artifact evidence for the proof without extracting a package", () => {
		const proof = buildRemoteWorkspaceControlProof();
		const validation = validateTaskArtifactManifest(proof.artifactManifest);

		assert.equal(proof.schema, "refarm.remote-workspace-control-proof.v1");
		assert.equal(proof.boundary.packageExtraction, false);
		assert.equal(proof.boundary.canonicalProtocol, "none");
		assert.equal(proof.boundary.appOwnedContract, false);
		assert.deepEqual(proof.boundary.transportSpecificAdapters, [
			"tailscale",
			"telegram",
			"matrix",
			"pwa",
			"android",
			"ssh",
		]);
		assert.deepEqual(validation, { ok: true, issues: [] });
		assert.equal(proof.artifactManifest.artifacts[0].role, "audit-trail");
		assert.equal(
			proof.artifactManifest.artifacts[0].provenance.process.display,
			"refarm check --next-action --json",
		);
		assert.deepEqual(proof.artifactManifest.artifacts[0].labels, [
			"remote-workspace",
			"control-plane",
			"proof",
		]);
	});
});
