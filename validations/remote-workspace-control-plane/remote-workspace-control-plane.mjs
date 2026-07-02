import { createHash } from "node:crypto";
import { TASK_ARTIFACT_MANIFEST_SCHEMA } from "../../packages/artifact-contract-v1/dist/index.js";
import { createProcessHandoffSpecFromRunner } from "../../packages/process-handoff/dist/index.js";
import { STREAM_CAPABILITY } from "../../packages/stream-contract-v1/dist/index.js";

export const ISSUED_AT = "2026-06-30T00:00:00.000Z";
export const TASK_ID = "task-remote-workspace-control-plane-proof";
export const EFFORT_ID = "effort-remote-workspace-control-plane-proof-001";
export const RUN_ID = "remote-workspace-control-plane-proof-001";
export const PROOF_SCHEMA = "refarm.remote-workspace-node.proof.v1";
export const STREAM_REF = "stream-remote-workspace-control-plane-proof-001";

export function buildRemoteNodeDescriptor() {
	return {
		schema: PROOF_SCHEMA,
		nodeId: "home-workstation",
		label: "Home workstation",
		transport: {
			kind: "loopback",
			endpoint: "http://127.0.0.1:42001",
		},
		workspace: {
			id: "refarm",
			root: "/workspaces/refarm",
			mode: "read-only",
		},
		capabilities: {
			status: true,
			boundedReadOnlyProcess: true,
			stream: true,
			cancel: true,
			artifactEvidence: true,
		},
		policy: {
			rawShell: false,
			mutation: false,
			requiresHumanApproval: false,
		},
	};
}

export function validateRemoteNodeDescriptor(descriptor) {
	const issues = [];
	if (descriptor?.schema !== PROOF_SCHEMA) {
		issues.push("descriptor schema must stay proof-local");
	}
	if (!descriptor?.nodeId) issues.push("nodeId is required");
	if (!descriptor?.label) issues.push("label is required");
	if (descriptor?.transport?.kind !== "loopback") {
		issues.push("first proof must use loopback transport");
	}
	if (!descriptor?.workspace?.id || !descriptor?.workspace?.root) {
		issues.push("workspace id and root are required");
	}
	if (descriptor?.workspace?.mode !== "read-only") {
		issues.push("first proof workspace must be read-only");
	}
	if (descriptor?.policy?.rawShell !== false) {
		issues.push("raw shell must be refused by default");
	}
	if (descriptor?.policy?.mutation !== false) {
		issues.push("mutation must be refused by default");
	}
	return { ok: issues.length === 0, issues };
}

export function buildRemoteNodeStatus(
	descriptor = buildRemoteNodeDescriptor(),
	environmentPressure = {
		decision: "continue",
		signals: [
			{
				id: "host-memory-available",
				ok: true,
				summary: "Synthetic proof fixture has enough memory headroom.",
			},
			{
				id: "filesystem-free-space",
				ok: true,
				summary: "Synthetic proof fixture has enough workspace disk headroom.",
			},
		],
	},
) {
	const allowedOperations = [];
	const refusedOperations = [];
	if (descriptor.capabilities.status) allowedOperations.push("status");
	if (descriptor.capabilities.boundedReadOnlyProcess) {
		allowedOperations.push("bounded-read-only-process");
	}
	if (descriptor.capabilities.stream) allowedOperations.push("stream");
	if (descriptor.capabilities.cancel) allowedOperations.push("cancel");
	if (descriptor.capabilities.artifactEvidence) {
		allowedOperations.push("artifact-evidence");
	}
	if (!descriptor.policy.rawShell) {
		refusedOperations.push({
			operation: "raw-shell",
			reason: "raw shell is an elevated capability, not part of the first proof",
		});
	}
	if (!descriptor.policy.mutation || descriptor.workspace.mode === "read-only") {
		refusedOperations.push({
			operation: "mutation",
			reason: "first proof is read-only and must not mutate source or workspace state",
		});
	}
	return {
		schema: "refarm.remote-workspace-status.proof.v1",
		createdAt: ISSUED_AT,
		nodeId: descriptor.nodeId,
		label: descriptor.label,
		transportKind: descriptor.transport.kind,
		workspace: descriptor.workspace,
		runtime: {
			ready: true,
			mode: "proof-fixture",
		},
		environmentPressure,
		allowedOperations,
		refusedOperations,
	};
}

export function buildBoundedReadOnlyEffort(descriptor = buildRemoteNodeDescriptor()) {
	const status = buildRemoteNodeStatus(descriptor);
	const blockers = status.refusedOperations.filter((item) =>
		item.operation !== "raw-shell" && item.operation !== "mutation"
	);
	const process = createProcessHandoffSpecFromRunner(
		"refarm",
		["check", "--next-action", "--json"],
		{
			cwd: descriptor.workspace.root,
			display: "refarm check --next-action --json",
			packageManager: null,
		},
	);
	return {
		schema: "refarm.remote-workspace-effort.proof.v1",
		taskId: TASK_ID,
		effortId: EFFORT_ID,
		nodeId: descriptor.nodeId,
		workspaceId: descriptor.workspace.id,
		mode: "read-only",
		policyDecision: {
			state: blockers.length === 0 ? "allowed" : "refused",
			blockers,
		},
		process,
	};
}

export function buildStreamTranscript(streamRef = STREAM_REF) {
	return {
		capability: STREAM_CAPABILITY,
		streamRef,
		chunks: [
			{
				stream_ref: streamRef,
				content: "{\"ok\":true",
				sequence: 0,
				is_final: false,
				payload_kind: "text_delta",
			},
			{
				stream_ref: streamRef,
				content: ",\"nextAction\":null}\n",
				sequence: 1,
				is_final: true,
				payload_kind: "final_text",
				metadata: {
					exitCode: 0,
					command: "refarm check --next-action --json",
				},
			},
		],
	};
}

export function buildCancelDecision({ state = "already-complete", operation = "cancel" } = {}) {
	const reasons = {
		cancelled: "bounded read-only effort accepted cancellation before final chunk",
		"not-cancellable": "bounded read-only effort does not expose cancellation",
		"already-complete": "bounded read-only effort completed before cancellation arrived",
		"refused-by-policy": "policy refused cancellation for this operation",
	};
	return {
		operation,
		state,
		reason: reasons[state] ?? "unknown cancellation state",
	};
}

export function buildRemoteWorkspaceControlProof() {
	const descriptor = buildRemoteNodeDescriptor();
	const descriptorValidation = validateRemoteNodeDescriptor(descriptor);
	const status = buildRemoteNodeStatus(descriptor);
	const effort = buildBoundedReadOnlyEffort(descriptor);
	const stream = buildStreamTranscript();
	const cancel = buildCancelDecision();
	const report = {
		schema: "refarm.remote-workspace-control-proof.v1",
		createdAt: ISSUED_AT,
		descriptor,
		descriptorValidation,
		status,
		effort,
		stream,
		cancel,
		boundary: {
			packageExtraction: false,
			canonicalProtocol: "none",
			transportSpecificAdapters: [
				"tailscale",
				"telegram",
				"matrix",
				"pwa",
				"android",
				"ssh",
			],
			appOwnedContract: false,
		},
	};
	return {
		...report,
		artifactManifest: buildTaskArtifactManifest(report),
	};
}

export function buildTaskArtifactManifest(report) {
	const hash = sha256Json(report);
	const process = report.effort.process;
	return {
		schema: TASK_ARTIFACT_MANIFEST_SCHEMA,
		taskId: TASK_ID,
		effortId: EFFORT_ID,
		createdAt: ISSUED_AT,
		artifacts: [
			{
				id: "remote-workspace-control-proof",
				uri: "remote-workspace-control-proof.json",
				mediaType: "application/json",
				role: "audit-trail",
				hash: {
					algorithm: "sha256",
					value: hash,
				},
				reviewState: "unreviewed",
				labels: ["remote-workspace", "control-plane", "proof"],
				provenance: {
					runId: RUN_ID,
					producer: "remote-workspace-control-plane:proof",
					command: process.display,
					process,
					source: "validations/remote-workspace-control-plane",
					producedAt: ISSUED_AT,
				},
			},
		],
	};
}

function sha256Json(value) {
	return createHash("sha256")
		.update(`${JSON.stringify(value, null, 2)}\n`)
		.digest("hex");
}
