/**
 * WHAT CODE THIS NODE ACTUALLY EXECUTES.
 *
 * Measured on a real node 2026-08-19, chasing why it did not come back after a reboot:
 *
 *   systemd unit  ->  ~/.local/bin/refarm  ->  ~/github/refarm/apps/refarm/dist/index.js
 *
 * The launcher is a shim into a git working tree. Every supervised service on that node runs the
 * development repo's build output, and the unit names a path under `~/.local/bin`, so nothing
 * about it looks that way.
 *
 * RUNNING THE WORKING TREE IS NOT THE DEFECT. It is the fastest loop there is, and this repository
 * is the operator's own instrument — editing it and using it in the same breath is the point. The
 * defect is that nothing SAYS the two are the same thing, so a development action and a node
 * action are indistinguishable until one breaks the other.
 *
 * This says it. Separating them is a packaging project (the CLI resolves workspace packages
 * through a runtime loader, so copying `dist/` is not enough); this makes that project's absence
 * visible rather than silent.
 */
import path from "node:path";
import fs from "node:fs";

/**
 * @typedef {{ kind: "installed", executes: string }
 *   | { kind: "working-tree", executes: string, repository: string }
 *   | { kind: "unknown" }} NodeSubstrate
 */

/**
 * PURE. Where the code this process runs lives, and whether a git tree encloses it.
 *
 * `isDirectory` is injected so this is testable without a filesystem, and so a caller can answer
 * for a path that is not this machine's.
 *
 * @param {string | undefined} entrypoint
 * @param {(candidate: string) => boolean} [isDirectory]
 * @returns {NodeSubstrate}
 */
export function readNodeSubstrate(entrypoint, isDirectory = defaultIsDirectory) {
	const executes = typeof entrypoint === "string" ? entrypoint.trim() : "";
	// UNKNOWN, never `installed`. A node that cannot say what it runs must not report the
	// reassuring answer about something nothing measured.
	if (!executes) return { kind: "unknown" };

	let dir = path.dirname(path.resolve(executes));
	// Bounded by the root rather than by a hop count: a deep monorepo is normal, an infinite
	// filesystem is not.
	for (;;) {
		if (isDirectory(path.join(dir, ".git"))) {
			return { kind: "working-tree", executes, repository: dir };
		}
		const parent = path.dirname(dir);
		if (parent === dir) return { kind: "installed", executes };
		dir = parent;
	}
}

function defaultIsDirectory(candidate) {
	try {
		return fs.statSync(candidate).isDirectory();
	} catch {
		return false;
	}
}

/**
 * PURE. The fact, for a substrate worth explaining. Never names a CLI verb — the handoff belongs
 * where every other one is rendered.
 *
 * @param {NodeSubstrate} substrate
 * @returns {string | null}
 */
export function describeSubstrate(substrate) {
	if (substrate.kind === "installed") return null;
	if (substrate.kind === "unknown") {
		return "this node could not say which code it executes, so nothing here can tell whether it is a working tree or an installed copy.";
	}
	return (
		`this node executes code from the git working tree at ${substrate.repository}. ` +
		"That is the fastest development loop and it couples three things that look separate: a " +
		"build rewrites what its live services run, a branch switch changes them silently, and a " +
		"backup carries the node's configuration without the code, so a restore elsewhere yields a " +
		"configured node with nothing to execute."
	);
}
