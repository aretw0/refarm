/**
 * THE PURE HALF OF INSTALLING A NODE.
 *
 * `refarm node install` assembles a self-contained tree, VERIFIES it by running it, and only then
 * repoints the launcher — keeping the previous one so a rollback is one command.
 *
 * Every decision here was made by hand on the operator's node on 2026-08-19, while proving the
 * node could stop executing the development working tree (ISS-154). They are written down so the
 * next install does not repeat the reasoning, and kept pure so the reasoning is testable without
 * assembling 434MB.
 *
 * WHY HERE and not in a package: `backup` is this operation's sibling — assemble, verify, record —
 * and lives beside it. No existing package covers installing the CLI (`runtime-operator` scopes
 * itself to the runtime daemon, `release-engine` to publication), and a package for one consumer
 * is the speculative generality this repository keeps removing. The pure/impure split is what
 * makes the move cheap if a second consumer ever appears.
 */

/**
 * PURE. The name an assembled tree is filed under.
 *
 * The commit rides along because two installs of "0.1.0" from different commits are different
 * trees, and an operator rolling back has to tell them apart in a directory listing. Absent when
 * there is nothing to name — an install from a tarball has no commit, and inventing one produces
 * a label that looks traceable and is not.
 */
export function installVersionLabel(version: string, commit: string | null): string {
	const short = commit?.trim();
	return short ? `${version}-${short}` : version;
}

/**
 * PURE. Where an assembled tree lives: beside the launcher, never inside the sovereign directory.
 *
 * `~/.refarm` is what `backup plan` walks. Measured this session: 434MB of code there lands as
 * `undecidable` and takes the whole backup plan back to "not yet trustworthy" — a node that cannot
 * be backed up because it was installed.
 */
export function installedTreePath(home: string, label: string): string {
	return `${home}/.local/lib/refarm/${label}`;
}

export interface ShimInput {
	/** The interpreter to exec — the one currently running, so an install cannot silently move
	 *  the node onto a different Node than the one it was verified with. */
	readonly node: string;
	readonly entrypoint: string;
	readonly shimPath: string;
}

/**
 * PURE. The launcher script.
 *
 * `REFARM_COMMAND` is exported because `deriveRefarmInvocation` reads it FIRST: a supervised unit
 * declared through `process add` then keeps pointing at the launcher rather than at whichever
 * build happened to be current when it was written.
 *
 * The rollback line is in the file because an operator reads this file at the moment something is
 * wrong, and that is exactly when it is worth two lines.
 */
export function shimScript(input: ShimInput): string {
	return [
		"#!/usr/bin/env bash",
		"set -euo pipefail",
		"# Written by `refarm node install`. This node runs an INSTALLED tree, not a git working",
		"# tree — see docs/NODE_SUBSTRATE.md and ISS-154.",
		`# Rollback:  cp "${input.shimPath}.previous" "${input.shimPath}"`,
		`export REFARM_COMMAND="${input.shimPath}"`,
		`exec "${input.node}" "${input.entrypoint}" "$@"`,
		"",
	].join("\n");
}

export interface VerificationInput {
	readonly status: number | null;
	readonly stdout: string;
	readonly stderr?: string;
}

export interface VerificationVerdict {
	readonly ok: boolean;
	readonly because: string;
}

/**
 * PURE. Did the assembled tree actually answer?
 *
 * THE STEP THAT SEPARATES AN INSTALL FROM A HOPE. An assemble that reports success without running
 * what it assembled is the shape of backup that fails on the day it is needed — and this session
 * met the same failure twice, once with a `cargo check` that produced no binary and once with a
 * guard that could not fire.
 *
 * Exit 0 with NO OUTPUT is not an answer. A tree that runs and says nothing has not been shown to
 * work.
 */
export function verificationVerdict(input: VerificationInput): VerificationVerdict {
	if (input.status === null) {
		return { ok: false, because: "the assembled tree could not be started at all." };
	}
	if (input.status !== 0) {
		const said = (input.stderr || input.stdout || "").trim().slice(0, 300);
		return {
			ok: false,
			because: `the assembled tree exited ${input.status}${said ? `: ${said}` : ""}.`,
		};
	}
	if (!input.stdout.trim()) {
		return {
			ok: false,
			because:
				"the assembled tree exited 0 and printed nothing. Running without answering is not " +
				"evidence that it works, and this step exists to refuse exactly that.",
		};
	}
	return { ok: true, because: `the assembled tree answered: ${input.stdout.trim().slice(0, 80)}` };
}
