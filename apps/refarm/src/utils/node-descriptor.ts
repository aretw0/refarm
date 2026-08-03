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

	return {
		declarationBase,
		sovereignDir,
		pid,
		startedAt: typeof record.startedAt === "string" ? record.startedAt : "",
	};
}
