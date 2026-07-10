import { buildJsonErrorEnvelope } from "@refarm.dev/capabilities/envelope";
import type { PluginPolicyMode } from "@refarm.dev/plugin-manifest";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
	buildExtensionInstallReport,
	type ExtensionInstallReport,
} from "./plugin-install-from-path.js";

/**
 * Install a plugin from a `git` reference (ADR-086 Fase 7c) — `plugin install
 * git+https://host/repo.git` (optionally `…#<ref>` for a branch/tag/commit). A git
 * repo is just a directory, so — with the multi-kind installer — a git install is:
 * shallow-clone the repo to a temp dir, locate its manifest (root or `dist/`), then
 * run the SAME review-first local installer. git gains the local installer's exact
 * safety (review gate + integrity + content-store) AND its multi-kind support (the
 * repo may ship a .wasm OR a .js/.mjs/.cjs entry).
 *
 * SCOPE (the repo's own convention): installers DON'T build — even the bundled path
 * tells the operator to build manually. So a git install clones a repo that ALREADY
 * SHIPS its built entry (a `.wasm` or `.js`, next to a `plugin.json`). A repo with no
 * built entry fails LOUDLY (build + commit the artifact, or publish via npm), never a
 * build shelled from inside the command.
 */

const pexec = promisify(execFile);

/** Where a repo's `plugin.json` may live, relative to the clone root. */
const MANIFEST_DIR_CANDIDATES = [".", "dist"] as const;
const MANIFEST_FILENAMES = ["plugin.json", "ext.json"] as const;

/** Clone a git remote (at an optional ref) into `dest`. Injected so tests supply a
 * stub and no network / git subprocess runs. */
export type CloneRepo = (input: { remote: string; ref?: string; dest: string }) => Promise<void>;

/** The default clone: a SHALLOW `git clone --depth 1` (history is irrelevant to an
 * install), honoring `--branch <ref>` when a ref is given. `execFile` (no shell). */
const defaultCloneRepo: CloneRepo = async ({ remote, ref, dest }) => {
	const args = ["clone", "--depth", "1"];
	if (ref) args.push("--branch", ref);
	args.push(remote, dest);
	await pexec("git", args, { maxBuffer: 64 * 1024 * 1024 });
};

export interface GitInstallInput {
	/** The git reference (`git+…`, `git@…`, or an `https://…/….git`, optional `#ref`). */
	ref: string;
	grantedCapabilities: string[];
	policyMode: PluginPolicyMode;
	/** Injected clone (default: shallow `git clone`). */
	cloneRepo?: CloneRepo;
}

/** Split a git ref into its remote URL and optional `#<ref>` (branch/tag/commit),
 * stripping a leading `git+` (the npm-style scheme prefix). */
function parseGitRef(ref: string): { remote: string; gitRef?: string } {
	let value = ref.trim();
	if (value.startsWith("git+")) value = value.slice("git+".length);
	const hash = value.lastIndexOf("#");
	// Only treat a trailing `#…` as a ref (an SSH `git@host:owner/repo` has no `#`).
	if (hash !== -1) {
		return { remote: value.slice(0, hash), gitRef: value.slice(hash + 1) || undefined };
	}
	return { remote: value };
}

function findManifestDir(root: string): string | null {
	for (const rel of MANIFEST_DIR_CANDIDATES) {
		const dir = path.join(root, rel);
		if (MANIFEST_FILENAMES.some((name) => existsSync(path.join(dir, name)))) {
			return dir;
		}
	}
	return null;
}

export async function buildGitInstallReport(
	input: GitInstallInput,
): Promise<ExtensionInstallReport | ReturnType<typeof buildJsonErrorEnvelope>> {
	const cloneRepo = input.cloneRepo ?? defaultCloneRepo;
	const { remote, gitRef } = parseGitRef(input.ref);

	// 1) Shallow-clone into a temp dir. Cleaned up in `finally`, so a failed or
	//    successful install never leaves the checkout behind.
	const cloneDir = mkdtempSync(path.join(tmpdir(), "refarm-git-plugin-"));
	try {
		try {
			await cloneRepo({ remote, ref: gitRef, dest: cloneDir });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return buildJsonErrorEnvelope({
				command: "plugin",
				operation: "install",
				error: "git_clone_failed",
				message: `Could not clone ${remote}${gitRef ? ` (ref ${gitRef})` : ""}: ${message}`,
				nextAction: "Check the git URL, the ref, and your access, then retry.",
				extra: { ref: input.ref, remote },
			});
		}

		// 2) Locate the plugin manifest in the clone (root or dist/).
		const manifestDir = findManifestDir(cloneDir);
		if (!manifestDir) {
			return buildJsonErrorEnvelope({
				command: "plugin",
				operation: "install",
				error: "git_manifest_not_found",
				message: `The repository ${remote} does not ship a plugin.json (looked at the repo root and dist/). Build and commit the plugin artifacts, or publish it via npm.`,
				nextAction: "Ensure the repo ships a built plugin.json + entry, or install from npm.",
				extra: { ref: input.ref, remote },
			});
		}

		// 3) Delegate to the review-first, multi-kind local installer — git gains the
		//    same gate (review + grants + integrity) and installs any code entry.
		return await buildExtensionInstallReport({
			targetPath: manifestDir,
			grantedCapabilities: input.grantedCapabilities,
			policyMode: input.policyMode,
			commandName: "plugin",
		});
	} finally {
		rmSync(cloneDir, { recursive: true, force: true });
	}
}
