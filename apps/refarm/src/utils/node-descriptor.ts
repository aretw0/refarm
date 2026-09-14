// Reading what the node says about itself — the other half of `node_descriptor.rs`.
//
// The daemon publishes `<refarm-home>/node.json` at boot: the base it actually resolves
// declarations against, plus the pid that wrote it. This reads it, and refuses to believe
// a descriptor whose process is gone.
//
// That refusal is the whole point. A file outlives its writer, so a descriptor from a dead
// node is history presented as fact — the same shape of lie the declared-base work exists
// to remove, and it would be perverse to introduce it here. Absence, an unknown `wire`, a
// malformed file and a dead pid all mean the same thing: this node does not say. Callers
// then fall back to what they can compute locally, which is what they did before.

import fs from "node:fs";
import path from "node:path";

/** The contract this reader understands. A descriptor announcing anything else is refused
 *  rather than guessed at — a newer node may mean something different by the same field. */
export const NODE_DESCRIPTOR_WIRE = "node-descriptor.v1";
const NODE_DESCRIPTOR_FILE = "node.json";

export interface NodeDescriptor {
	/** Where the RUNNING node resolves declarations against. */
	declarationBase: string;
	sovereignDir: string;
	pid: number;
	startedAt: string;
	/** This node's declared, human-chosen name (`config.json`'s `node.name`) — absent when
	 *  the node has not declared one. Mirrors `node_descriptor.rs`'s `nodeName`: a missing
	 *  key, never an empty string, so "no name" cannot be confused with a name that happens
	 *  to be `""` (D6). See `packages/tractor/src/node_identity.rs`. */
	nodeName?: string;
	/** This node's opaque, per-installation id — absent only if the daemon could not mint
	 *  or persist one (disk full, permissions). Mirrors `node_descriptor.rs`'s `nodeId`;
	 *  never travels, never repeats across machines. */
	nodeId?: string;
}

/** Is the process that wrote this descriptor still there? Signal 0 asks without sending
 *  anything — the standard "does this pid exist and may I signal it" probe. */
function processIsAlive(pid: number, kill: (pid: number, signal: number) => void): boolean {
	try {
		kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * What the node running out of `refarmHome` says about itself, or `null` when it says
 * nothing this reader can trust.
 *
 * `readFile` and `kill` are injected so a test can state "the descriptor is there and its
 * process is gone" without spawning one.
 */
export function readNodeDescriptor(
	refarmHome: string,
	deps: {
		readFile?: (filePath: string) => string;
		kill?: (pid: number, signal: number) => void;
	} = {},
): NodeDescriptor | null {
	const readFile = deps.readFile ?? ((filePath: string) => fs.readFileSync(filePath, "utf8"));
	const kill = deps.kill ?? ((pid: number, signal: number) => void process.kill(pid, signal));

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFile(path.join(refarmHome, NODE_DESCRIPTOR_FILE)));
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;

	const record = parsed as Record<string, unknown>;
	if (record.wire !== NODE_DESCRIPTOR_WIRE) return null;
	const declarationBase = typeof record.declarationBase === "string" ? record.declarationBase : "";
	const sovereignDir = typeof record.sovereignDir === "string" ? record.sovereignDir : "";
	const pid = typeof record.pid === "number" && Number.isInteger(record.pid) ? record.pid : 0;
	if (!declarationBase || !sovereignDir || pid <= 0) return null;

	// The descriptor describes a node, or it describes one that used to be here.
	if (!processIsAlive(pid, kill)) return null;

	// Absent, not empty (D6) — an empty string is not a declared name any more than it is
	// anywhere else in this record.
	const nodeName = typeof record.nodeName === "string" && record.nodeName.length > 0
		? record.nodeName
		: undefined;
	const nodeId = typeof record.nodeId === "string" && record.nodeId.length > 0
		? record.nodeId
		: undefined;

	return {
		declarationBase,
		sovereignDir,
		pid,
		startedAt: typeof record.startedAt === "string" ? record.startedAt : "",
		...(nodeName !== undefined ? { nodeName } : {}),
		...(nodeId !== undefined ? { nodeId } : {}),
	};
}
