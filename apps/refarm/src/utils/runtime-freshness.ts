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
	realpath?: (target: string) => string | null;
}

function defaultStat(target: string): number | null {
	try {
		return fs.statSync(target).mtimeMs;
	} catch {
		return null;
	}
}

function defaultRealpath(target: string): string | null {
	try {
		return fs.realpathSync(target);
	} catch {
		return null;
	}
}

/**
 * The binary the process is actually executing, via `/proc/<pid>/exe`.
 *
 * Linux only, and deliberately not emulated elsewhere: on a platform where this cannot be
 * resolved the answer is `unknown`, not an assumption. `realpath` on a replaced binary
 * still resolves to the path, and its mtime is then NEWER than the process start — which is
 * precisely the condition worth reporting.
 */
function runningBinaryPath(pid: number, deps?: FreshnessDeps): string | null {
	if (process.platform !== "linux") return null;
	const realpath = deps?.realpath ?? defaultRealpath;
	return realpath(`/proc/${pid}/exe`);
}

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

	const artifacts: ArtifactFreshness[] = [
		compare(
			"daemon binary",
			runningBinaryPath(descriptor.pid, deps),
			startedAtMs,
			process.platform === "linux"
				? "the running binary could not be resolved from /proc"
				: "resolving a running process's binary is not implemented on this platform",
			deps,
		),
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
