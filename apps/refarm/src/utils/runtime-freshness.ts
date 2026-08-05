// Does the running node predate what is on disk?
//
// This exists because of a measured failure on 2026-08-04. The tractor daemon on this
// operator's machine started at 11:20 and the binary beside it was rebuilt at 20:34 — nine
// hours of fixes landing in a file the running process would never read. `refarm check
// --next-action --json` answered `ok: true, nextAction: null` the whole time, which is the
// "all clear" signal CLAUDE.md tells every agent to trust before dispatching work.
//
// The operator's own words that day were "como vou trabalhar bastante com o refarm se não
// consigo usar ele como agent de forma soberana?" — and the honest answer turned out to be
// that he COULD, but had spent the day exercising the morning's behaviour while fixes piled
// up unread. Nothing told him. A repair that silently stops reaching you is worse than no
// repair, because you stop being able to tell the two apart.
//
// THREE STATES, never two. A verifier that cannot check must say so rather than pass:
//   - `fresh`      — the artifact is older than the process that loaded it
//   - `stale`      — the artifact changed AFTER the process started
//   - `unknown`    — the descriptor is absent, the process is gone, the artifact could not
//                    be found, or this platform does not expose what is needed
// Collapsing `unknown` into `fresh` would rebuild the exact defect this file was written to
// remove.

import fs from "node:fs";
import path from "node:path";

export type FreshnessState = "fresh" | "stale" | "unknown";

export interface ArtifactFreshness {
	/** What was compared — a path when one was found, else the name of what was sought. */
	artifact: string;
	state: FreshnessState;
	/** Why, in one sentence an operator can act on. Always present, including when fresh. */
	reason: string;
	/** ISO stamp of the artifact's last modification, when it could be read. */
	modifiedAt?: string;
}

export interface RuntimeFreshness {
	/** `stale` when ANY artifact is stale; `unknown` when none is stale but some are
	 *  unknown; `fresh` only when every artifact was checked and every one was older than
	 *  the running process. Worst-state-wins, so a single unreadable artifact cannot be
	 *  averaged into an all-clear. */
	state: FreshnessState;
	/** The node's own `startedAt`, echoed so a reader can see what the comparison used. */
	startedAt?: string;
	artifacts: ArtifactFreshness[];
}

interface FreshnessDeps {
	statMtimeMs?: (target: string) => number | null;
	readlink?: (target: string) => string | null;
	readArgv0?: (pid: number) => string | null;
}

function defaultStat(target: string): number | null {
	try {
		return fs.statSync(target).mtimeMs;
	} catch {
		return null;
	}
}

function defaultReadlink(target: string): string | null {
	try {
		return fs.readlinkSync(target);
	} catch {
		return null;
	}
}

function defaultArgv0(pid: number): string | null {
	try {
		const argv0 = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0")[0];
		return argv0 && argv0.length > 0 ? argv0 : null;
	} catch {
		return null;
	}
}

/**
 * What `/proc/<pid>/exe` says about the binary a process is executing.
 *
 * Linux only, and deliberately not emulated elsewhere: on another platform the answer is
 * `unknown`, never an assumption.
 *
 * Three outcomes, and the middle one is the case that actually occurs. Verified on the
 * operator's machine 2026-08-04: cargo had REPLACED the daemon's binary, so the kernel's
 * link read `<path> (deleted)` and `realpath` failed with ENOENT on that literal. An
 * earlier draft treated that as "could not check", which is exactly backwards — a running
 * image that no longer exists on disk is the STRONGEST form of stale there is, not the
 * weakest form of knowledge. Nothing about the file's timestamp is needed to say so.
 */
type RunningBinary =
	| { kind: "path"; path: string }
	| { kind: "deleted"; path: string }
	| { kind: "unresolvable" };

function runningBinary(pid: number, deps?: FreshnessDeps): RunningBinary {
	if (process.platform !== "linux") return { kind: "unresolvable" };
	const readlink = deps?.readlink ?? defaultReadlink;
	const link = readlink(`/proc/${pid}/exe`);
	if (link) {
		const deleted = link.endsWith(DELETED_SUFFIX);
		return deleted
			? { kind: "deleted", path: link.slice(0, -DELETED_SUFFIX.length) }
			: { kind: "path", path: link };
	}
	// The link itself was unreadable. argv[0] is the next best thing a process publishes
	// about what it is running — less precise, since it can be relative, but it is a fact
	// the process itself stated rather than a guess about it.
	const argv0 = (deps?.readArgv0 ?? defaultArgv0)(pid);
	return argv0 ? { kind: "path", path: argv0 } : { kind: "unresolvable" };
}

const DELETED_SUFFIX = " (deleted)";

function compare(
	artifact: string,
	target: string | null,
	startedAtMs: number,
	missingReason: string,
	deps?: FreshnessDeps,
): ArtifactFreshness {
	if (!target) return { artifact, state: "unknown", reason: missingReason };
	const stat = deps?.statMtimeMs ?? defaultStat;
	const mtime = stat(target);
	if (mtime === null) {
		return { artifact: target, state: "unknown", reason: "could not read its modification time" };
	}
	const modifiedAt = new Date(mtime).toISOString();
	if (mtime > startedAtMs) {
		return {
			artifact: target,
			state: "stale",
			reason: "changed after the running node started, so the node is not running it",
			modifiedAt,
		};
	}
	return {
		artifact: target,
		state: "fresh",
		reason: "older than the running node, so the node loaded this version",
		modifiedAt,
	};
}

/**
 * Compare what the node says about itself against the artifacts it would load.
 *
 * `descriptor` is the parsed `node.json` — pass `null` when the reader refused it (absent,
 * malformed, unknown wire, or a dead pid). A refused descriptor means the node does not
 * say, and this answers `unknown` rather than inventing a comparison.
 */
export function resolveRuntimeFreshness(
	descriptor: { pid: number; startedAt: string; sovereignDir?: string } | null,
	agentPluginPath: string | null,
	deps?: FreshnessDeps,
): RuntimeFreshness {
	if (!descriptor) {
		return {
			state: "unknown",
			artifacts: [
				{
					artifact: "node.json",
					state: "unknown",
					reason: "the node does not say when it started, so nothing can be compared to it",
				},
			],
		};
	}

	const startedAtMs = Date.parse(descriptor.startedAt);
	if (!Number.isFinite(startedAtMs)) {
		return {
			state: "unknown",
			startedAt: descriptor.startedAt,
			artifacts: [
				{
					artifact: "node.json",
					state: "unknown",
					reason: "the node's startedAt could not be parsed as a date",
				},
			],
		};
	}

	const binary = runningBinary(descriptor.pid, deps);
	const binaryFreshness: ArtifactFreshness =
		binary.kind === "deleted"
			? {
					artifact: binary.path,
					state: "stale",
					reason:
						"the running image no longer exists on disk — it was replaced after this node " +
						"started, so the node is executing a build you can no longer inspect",
				}
			: compare(
					"daemon binary",
					binary.kind === "path" ? binary.path : null,
					startedAtMs,
					process.platform === "linux"
						? "the running binary could not be resolved from /proc"
						: "resolving a running process's binary is not implemented on this platform",
					deps,
				);

	const artifacts: ArtifactFreshness[] = [
		binaryFreshness,
		compare(
			"agent plugin",
			agentPluginPath,
			startedAtMs,
			"the installed agent plugin could not be located",
			deps,
		),
	];

	// Worst state wins. A stale artifact is the finding; an unknown one is a gap in our
	// checking and must not be averaged away by a fresh sibling.
	const state: FreshnessState = artifacts.some((a) => a.state === "stale")
		? "stale"
		: artifacts.some((a) => a.state === "unknown")
			? "unknown"
			: "fresh";

	return { state, startedAt: descriptor.startedAt, artifacts };
}

/** Where a node keeps the agent plugin it loads. `null` when no sovereign dir is known. */
export function defaultAgentPluginPath(sovereignDir: string | undefined): string | null {
	if (!sovereignDir) return null;
	return path.join(sovereignDir, "plugins", "@refarm", "agent", "plugin.wasm");
}
