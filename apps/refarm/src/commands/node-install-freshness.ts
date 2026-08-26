// apps/refarm/src/commands/node-install-freshness.ts
/**
 * PURE. Whether the tree an install is about to assemble carries the source it claims to.
 *
 * DECIDED BY CONTENT, NOT BY MTIME, and that choice is the point. `ProjectAuditor` reports
 * `staleBySeconds` from mtimes, which is the right signal for a health WARNING and the wrong
 * one for a REFUSAL: a checkout, a `touch`, or a rebuild that produced identical bytes all
 * move an mtime without changing what ships. A refusal derived from the same proxy the
 * installer uses would share its blind spot and could not report it (AGENTS.md §9).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface PackageFreshness {
	readonly id: string;
	readonly srcDigest: string | null;
	readonly distDigest: string | null;
	readonly staleBySeconds: number;
}

export interface TreeFreshness {
	readonly state: "fresh" | "stale" | "unknown";
	readonly packages: readonly { id: string; staleBySeconds: number }[];
}

export function readTreeFreshness(input: {
	readonly packages: readonly PackageFreshness[];
}): TreeFreshness {
	const undecidable = input.packages.filter((p) => p.srcDigest === null || p.distDigest === null);
	if (undecidable.length > 0) return { state: "unknown", packages: [] };

	const stale = input.packages
		.filter((p) => p.srcDigest !== p.distDigest)
		.map((p) => ({ id: p.id, staleBySeconds: p.staleBySeconds }));

	return stale.length > 0
		? { state: "stale", packages: stale }
		: { state: "fresh", packages: [] };
}

/** The sentence an operator reads, or null when there is nothing to refuse. */
export function freshnessRefusal(freshness: TreeFreshness): string | null {
	if (freshness.state === "fresh") return null;
	if (freshness.state === "unknown") {
		return (
			"freshness could not be read for the workspace being assembled, and an install that " +
			"cannot tell whether it carries your source is not one you can trust. Build, then retry."
		);
	}
	const named = freshness.packages
		.map((p) => `${p.id} (source is ${p.staleBySeconds}s ahead of dist)`)
		.join(", ");
	return `the tree would ship code older than the source: ${named}`;
}

/** The file a build writes so an installer can tell whether `dist` carries this source. */
export const SOURCE_STAMP = ".source-digest";

/** PURE-ish. A stable digest of every file under `dir`, by relative path and content. */
export function digestTree(dir: string): string | null {
	if (!existsSync(dir)) return null;
	const hash = createHash("sha256");
	const walk = (current: string) => {
		for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
			a.name.localeCompare(b.name),
		)) {
			if (entry.name === "node_modules" || entry.name === SOURCE_STAMP) continue;
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) walk(full);
			else hash.update(path.relative(dir, full)).update(readFileSync(full));
		}
	};
	walk(dir);
	return hash.digest("hex");
}

/** The workspaces an install assembles, each measured by CONTENT.
 *
 * `staleBySeconds` is carried for the REFUSAL TEXT only — an operator reads "19 minutes"
 * faster than two hashes. It never decides anything. */
export function measureWorkspaceFreshness(repoRoot: string): PackageFreshness[] {
	const pkgDir = path.join(repoRoot, "apps", "refarm");
	const srcDir = path.join(pkgDir, "src");
	const distDir = path.join(pkgDir, "dist");
	const stampPath = path.join(distDir, SOURCE_STAMP);
	const srcDigest = digestTree(srcDir);
	const distDigest = existsSync(stampPath) ? readFileSync(stampPath, "utf-8").trim() : null;
	const lag =
		existsSync(srcDir) && existsSync(distDir)
			? Math.max(0, Math.round((newestMtime(srcDir) - newestMtime(distDir)) / 1000))
			: 0;
	return [{ id: "apps/refarm", srcDigest, distDigest, staleBySeconds: lag }];
}

function newestMtime(dir: string): number {
	let newest = 0;
	const walk = (current: string) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (entry.name === "node_modules") continue;
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) walk(full);
			else newest = Math.max(newest, statSync(full).mtimeMs);
		}
	};
	walk(dir);
	return newest;
}
