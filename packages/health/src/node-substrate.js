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
 * @typedef {{ label: string, version: string, commit: string | null,
 *   checkout: { dirty: boolean, because: string }, installedAt: string,
 *   repository: string }} InstalledNodeIdentity
 */

/**
 * @typedef {{ kind: "installed", executes: string, identity?: InstalledNodeIdentity }
 *   | { kind: "working-tree", executes: string, repository: string }
 *   | { kind: "unknown" }} NodeSubstrate
 */

/**
 * PURE. Where the code this process runs lives, and whether a git tree encloses it.
 *
 * `isDirectory` is injected so this is testable without a filesystem, and so a caller can answer
 * for a path that is not this machine's.
 *
 * `readIdentity` is injected for the same reason and answers the second question this walk can
 * settle for free: an INSTALLED tree records who it is (`installed-node.json`, written by
 * `node install`), and the walk already passes its root on the way up. A tree assembled before
 * that file existed simply has none — absent, never invented.
 *
 * @param {string | undefined} entrypoint
 * @param {(candidate: string) => boolean} [isDirectory]
 * @param {(directory: string) => InstalledNodeIdentity | null} [readIdentity]
 * @returns {NodeSubstrate}
 */
export function readNodeSubstrate(
	entrypoint,
	isDirectory = defaultIsDirectory,
	readIdentity = defaultReadIdentity,
) {
	const executes = typeof entrypoint === "string" ? entrypoint.trim() : "";
	// UNKNOWN, never `installed`. A node that cannot say what it runs must not report the
	// reassuring answer about something nothing measured.
	if (!executes) return { kind: "unknown" };

	let dir = path.dirname(path.resolve(executes));
	/** @type {InstalledNodeIdentity | null} */
	let identity = null;
	// Bounded by the root rather than by a hop count: a deep monorepo is normal, an infinite
	// filesystem is not.
	for (;;) {
		// A git tree wins, and wins FIRST. A checkout has no identity file, and if one ever
		// appeared there it would describe an install rather than the tree being executed.
		if (isDirectory(path.join(dir, ".git"))) {
			return { kind: "working-tree", executes, repository: dir };
		}
		if (!identity) identity = readIdentity(dir);
		const parent = path.dirname(dir);
		if (parent === dir) {
			return identity ? { kind: "installed", executes, identity } : { kind: "installed", executes };
		}
		dir = parent;
	}
}

/** @param {string} directory @returns {InstalledNodeIdentity | null} */
function defaultReadIdentity(directory) {
	try {
		return JSON.parse(fs.readFileSync(path.join(directory, NODE_IDENTITY_FILE), "utf-8"));
	} catch {
		return null;
	}
}

/** The file `refarm node install` writes at the root of an assembled tree. */
export const NODE_IDENTITY_FILE = "installed-node.json";

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
 * SILENT WHEN THERE IS NOTHING TO SAY, and that is load-bearing (ISS-159). An installed node that
 * already runs what the checkout has needs no line, and a line that is always present is a line
 * nobody reads — it would bury the one that matters, which is the trap this repository removed
 * from the supervision surface the day before. The DATA is always in the substrate; only the prose
 * is conditional.
 *
 * `headCommit` is null wherever there is no checkout to compare against — a phone, a Raspberry Pi,
 * a released install. Silence there too: "up to date" would be a claim nothing measured.
 *
 * @param {NodeSubstrate} substrate
 * @param {string | null} [headCommit]
 * @returns {string | null}
 */
export function describeSubstrate(substrate, headCommit = null) {
	if (substrate.kind === "installed") return describeInstalledDrift(substrate, headCommit);
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

/**
 * PURE. How far the installed node has drifted from the checkout beside it, when that is worth a
 * sentence.
 *
 * A DIRTY BUILD IS DESCRIBED BY NO COMMIT AT ALL, so it is said even when the commits match: the
 * tree was assembled from a working directory that held changes, and matching `HEAD` proves
 * nothing about what went in. That is the whole of ISS-158 restated where the operator reads it.
 *
 * @param {{ kind: "installed", executes: string, identity?: InstalledNodeIdentity }} substrate
 * @param {string | null} headCommit
 * @returns {string | null}
 */
function describeInstalledDrift(substrate, headCommit) {
	const identity = substrate.identity;
	if (!identity) return null;
	if (identity.checkout?.dirty) {
		return (
			`this node runs ${identity.label}, assembled ${identity.installedAt} from a checkout that ` +
			`was not clean — ${identity.checkout.because} No commit describes what it executes, so ` +
			"the only way back to this exact build is the tree itself."
		);
	}
	if (!headCommit || !identity.commit) return null;
	if (headCommit.trim() === identity.commit.trim()) return null;
	return (
		`this node runs ${identity.label} (${identity.commit}), assembled ${identity.installedAt}, ` +
		`while the checkout beside it is at ${headCommit}. Ageing is legitimate — a node is meant ` +
		"to change when someone decides it should, not when a build happens to run."
	);
}

