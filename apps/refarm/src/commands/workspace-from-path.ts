import path from "node:path";

/**
 * A declared workspace reduced to what attribution needs: its id and where it lives.
 * Callers build these from the config catalog; this module never reads config itself.
 */
export interface DeclaredRoot {
	id: string;
	absolutePath: string;
}

/**
 * The workspace id a path belongs to, or `undefined` when it belongs to none.
 *
 * PURE BY CONSTRUCTION, and that is the point rather than a style preference. The
 * 2026-08-03 field failure was `process.cwd()` read ambiently, deep in resolution, by a
 * process whose cwd was the daemon's — the operator saw
 * `Command "code-boundaries" is not declared for workspace "rcdc5"`. This function reads
 * no cwd, no environment and no config: a caller that has no meaningful path passes none
 * and gets nothing, which is how a node-created session stays honestly unattributed.
 *
 * `undefined`, never `""`: the same "absent means absent" contract `Effort.workspaceId`
 * and the sidecar's `workspace_id: Option<String>` already carry.
 */
export function resolveWorkspaceFromPath(
	candidatePath: string,
	roots: DeclaredRoot[],
): string | undefined {
	if (!path.isAbsolute(candidatePath)) return undefined;
	const candidate = path.resolve(candidatePath);

	let best: { id: string; length: number } | undefined;
	for (const root of roots) {
		if (!path.isAbsolute(root.absolutePath)) continue;
		const rootPath = path.resolve(root.absolutePath);
		if (!isWithin(candidate, rootPath)) continue;
		// Longest matching prefix wins: with a root declared inside another, being in the
		// inner one attributes to the inner one, which is the more specific true statement.
		if (!best || rootPath.length > best.length) {
			best = { id: root.id, length: rootPath.length };
		}
	}
	return best?.id;
}

/**
 * Containment on path BOUNDARIES, not on string prefixes: `/home/op/refarm-old` shares
 * eleven characters with `/home/op/refarm` and is a different directory entirely.
 */
function isWithin(candidate: string, root: string): boolean {
	if (candidate === root) return true;
	const relative = path.relative(root, candidate);
	return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}
