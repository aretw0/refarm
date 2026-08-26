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
 *
 * `-dirty` EXISTS BECAUSE THE COMMIT ALONE WAS THAT SAME LIE (ISS-158). Measured 2026-08-22: the
 * tree filed under `0.1.0-c58ae2ba` carried a symbol that commit does not contain, because the
 * label is read from `git HEAD` while the tree is assembled from the working tree's `dist/`. The
 * two trees a rolling-back operator most needs to tell apart are exactly the ones this collapsed.
 *
 * `contentDigest` EXISTS BECAUSE THE COMMIT PLUS `-dirty` WAS STILL THAT SAME LIE. Measured
 * 2026-08-25: two installs of the same commit, minutes apart, carried different code under one
 * directory name — the working tree had moved between them and neither `commit` nor `dirty` (a
 * boolean) can say by how much. Absent under the same discipline as the commit: no digest, no
 * invented one.
 *
 * It does NOT distinguish two installs whose commit, dirty state, AND content digest all agree —
 * that residual case shares a path, and what separates them is the `installedAt` in the tree's
 * own identity file. Saying so here because a label that quietly stops being unique is how this
 * defect happened the first time.
 */
export function installVersionLabel(
	version: string,
	commit: string | null,
	dirty = false,
	contentDigest?: string,
): string {
	const short = commit?.trim();
	if (!short) return version;
	// THE DIGEST GOES IN THE DIRECTORY NAME, not beside it in a record, because the promise this
	// function makes is about a DIRECTORY LISTING. Measured 2026-08-25: two clean installs of
	// 57ff5cc1 carried different code under one name, and `installedAt` — which this docstring
	// already offers as the tiebreak for two dirty installs — does not say the content differs.
	const digest = contentDigest?.trim();
	const base = digest ? `${version}-${short}-${digest}` : `${version}-${short}`;
	// `-dirty` IS A STATEMENT ABOUT A DIFFERENCE FROM A NAMED COMMIT, so it needs one to name.
	// With no commit, the label already claims nothing and there is nothing to qualify.
	return dirty ? `${base}-dirty` : base;
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

/**
 * PURE. Which of pnpm's materialized packages came from a PATH in the workspace.
 *
 * pnpm encodes a directory under `.pnpm` as `<name>@<reference>`, with `/` written `+`. A registry
 * package carries a version (`chalk@5.3.0`); a package resolved from a workspace path carries
 * `file+<path>` (`@refarm.dev+model-account-contract-v1@file+packages+model-account-contract-v1`).
 *
 * WHY THE DISTINCTION EARNS ITS KEEP: measured on the operator's node 2026-08-22, 77 of 443
 * materializations came from the workspace and every file in them was hardlinked back to the
 * checkout. The other 366 are registry tarballs — content-addressed, and nothing ever rewrites
 * one — so copying them would buy no independence and cost the whole tree in disk.
 *
 * THE SEPARATOR IS THE FIRST `@` PAST A SCOPE — not the last, which is what the first version of
 * this looked for and why it did not work. pnpm appends a peer hash to a package that has peers
 * (`@refarm.dev+cli@file+packages+cli_@emnapi+core@1.11.1_..._f284c20f`), and that suffix carries
 * scoped names of its own. Measured on the real tree 2026-08-22: reading from the end landed
 * inside `@types+nod_...`, excluded the package, and left 1081 files hardlinked to the checkout
 * while the install called itself independent. The unit tests passed throughout — they used names
 * without peers. Only a measurement taken outside the tool found it.
 */
export function workspaceMaterializations(entries: readonly string[]): string[] {
	return entries.filter((entry) => {
		// From index 1: a scoped name opens with an `@` that separates nothing.
		const separator = entry.indexOf("@", 1);
		if (separator < 0) return false;
		return entry.slice(separator + 1).startsWith("file+");
	});
}

export interface SharedFile {
	readonly path: string;
}

export interface IndependenceInput {
	readonly shared: readonly SharedFile[];
}

/**
 * PURE. Is the assembled tree actually its own?
 *
 * THE STEP THAT SEPARATES A SELF-CONTAINED TREE FROM THE WORD FOR ONE — the sibling of
 * `verificationVerdict`, and it exists because the same install passed that one while failing this.
 *
 * Measured 2026-08-22: `pnpm deploy` hardlinks workspace packages into the tree, so
 * `~/.local/lib/refarm/<label>` shared inodes with `packages/<pkg>/dist`. A `tsc` run in the checkout
 * rewrote an installed file IN PLACE at 00:58; the node began importing a module that did not
 * exist in its own tree; nothing said so; and 33 hours later a reboot killed every unit at once,
 * with the credential timer having failed 4420 times in silence.
 *
 * No pnpm flag prevents it. `package-import-method=copy`, its environment form, and
 * `inject-workspace-packages=true` were each measured hardlinking anyway — the store is
 * content-addressed and hardlinks are its design. So the tree is made independent after assembly,
 * and this refuses to call it installed until it is.
 */
export function independenceVerdict(input: IndependenceInput): IndependenceVerdict {
	const count = input.shared.length;
	if (count === 0) {
		return { ok: true, because: "no file in the tree is shared with the checkout." };
	}
	return {
		ok: false,
		because:
			`${count} file(s) in the assembled tree still share storage with the checkout, so a ` +
			`build there would rewrite what this node runs — starting with ${input.shared[0]?.path}.`,
	};
}

export interface IndependenceVerdict {
	readonly ok: boolean;
	readonly because: string;
}

export interface DirtinessProbe {
	readonly status: number | null;
	readonly stdout: string;
}

export interface DirtinessVerdict {
	readonly dirty: boolean;
	readonly because: string;
}

/**
 * PURE. Did the checkout hold anything the commit does not?
 *
 * "COULD NOT TELL" IS DIRTY, and the asymmetry is the entire decision. A clean tree wrongly marked
 * dirty is an alarm; a dirty tree wrongly marked clean is a false assurance that travels into a
 * label an operator rolls back by, months later, believing it names a commit. This repository has
 * already chosen that side once — an install that reports success without running what it
 * installed is refused for the same reason.
 *
 * The verdict carries `because` rather than a bare boolean so the tree's identity file can say
 * WHICH kind of dirty it was. "Two files changed" and "git would not answer" are different facts,
 * and folding them is how this defect was born one level up.
 */
export function checkoutDirtiness(probe: DirtinessProbe): DirtinessVerdict {
	if (probe.status === null) {
		return { dirty: true, because: "git could not be run here, so nothing could be compared." };
	}
	if (probe.status !== 0) {
		return {
			dirty: true,
			because: `git could not report the working tree (exit ${probe.status}).`,
		};
	}
	const entries = probe.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (entries.length === 0) {
		return { dirty: false, because: "the checkout matched its commit." };
	}
	return {
		dirty: true,
		because: `the checkout held ${entries.length} uncommitted change(s) this commit does not have.`,
	};
}

/** The file a tree keeps its own identity in, at the root of the assembled tree. */
export const NODE_IDENTITY_FILE = "installed-node.json";

/**
 * WHAT AN INSTALLED TREE KNOWS ABOUT ITSELF (ISS-158/ISS-159).
 *
 * The label is a directory name — legible in an `ls`, and that is all a directory name can be. It
 * cannot carry WHEN, and it cannot say which kind of dirty. Both are what an operator deciding
 * whether to update a node actually asks, so the tree carries them itself.
 *
 * `checkout` is the whole verdict rather than a boolean, deliberately: "one file changed" and
 * "git would not answer" both produce `-dirty` in the label, and collapsing them in the record too
 * would repeat this defect one level down.
 */
export interface InstalledNodeIdentity {
	readonly label: string;
	readonly version: string;
	readonly commit: string | null;
	readonly checkout: DirtinessVerdict;
	readonly installedAt: string;
	/**
	 * WHICH checkout that commit belongs to. A commit is only meaningful against the history it
	 * came from, and a node is administrable from anywhere: reading this node's commit beside an
	 * unrelated repository's HEAD would produce a confident sentence about two histories that never
	 * met. A reader compares only when this matches the tree it is standing in.
	 */
	readonly repository: string;
}

