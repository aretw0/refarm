import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Distinguishes a PROJECT base from a NODE base.
 *
 * `refarm health` is legitimately run from two different kinds of place:
 *   - a PROJECT (a git repository, or a directory with its own package
 *     manifest) — where git-visibility and workspace/build audits mean
 *     something, because there is a tracked source tree to judge.
 *   - a NODE base (the operator's sovereign `~/.refarm` root, or any other
 *     bare directory) — which has no source tree of its own to audit, but
 *     can still legitimately host node-scoped concerns (e.g. the config
 *     graph node) that ConfigNodeAuditor already handles on its own terms.
 *
 * Auditors that assume the second axis (this file's whole reason to exist)
 * previously had no way to tell them apart: run at a node base, the git
 * auditor walked EVERY sibling directory it could find — including other
 * people's unrelated git repositories nested under the same home directory —
 * and reported their files as "git_ignored", a diagnostic that only means
 * something inside the repository that owns the ignore rule. That is not a
 * clean pass and not a real finding; it is a question this auditor had no
 * standing to answer. `detectProjectBase` gives project-shaped auditors a way
 * to say so explicitly instead of guessing.
 *
 * The check is local to `rootDir`, not a scan of its contents: it asks "is
 * THIS directory itself part of a project", never "does something under it
 * look like one" — the latter is exactly how the defect above walked into
 * `~/git/*` and reported on repositories it does not own.
 */
export function detectProjectBase(rootDir) {
	if (isInsideGitWorkTree(rootDir)) return { isProject: true, reason: null };
	if (hasPackageManifest(rootDir)) return { isProject: true, reason: null };

	return {
		isProject: false,
		reason: `${rootDir} is not a git repository and has no package.json — it is a node base, not a project, so git-visibility and workspace/build audits have no standing to judge it.`,
	};
}

function isInsideGitWorkTree(rootDir) {
	try {
		const output = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
			cwd: rootDir,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		return output.trim() === "true";
	} catch {
		return false;
	}
}

function hasPackageManifest(rootDir) {
	try {
		return fs.existsSync(path.join(rootDir, "package.json"));
	} catch {
		return false;
	}
}
