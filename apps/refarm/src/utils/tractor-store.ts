import { createNodeView } from "@refarm.dev/storage-node-view";
import { TractorNodesReadProvider } from "@refarm.dev/storage-sqlite/node";
import fs from "node:fs";
import path from "node:path";
import { resolveRefarmHome } from "./refarm-home.js";

/**
 * Shared read access to the tractor host's local sovereign store — one source of
 * truth so every command (health, status, future readers) resolves the SAME db
 * and namespace the daemon actually opens, instead of each guessing its own.
 *
 * All resolvers are env-injectable (mirroring refarm-home.ts) so tests and other
 * apps can drive them. This module has zero app-command imports and a
 * package-clean signature: the day a second app needs the tractor store, it lifts
 * verbatim into a small package.
 */

/**
 * The storage namespace the daemon opens. Mirrors the Rust daemon's clap
 * resolution (`--namespace flag > REFARM_NAMESPACE env > "default"`, main.rs).
 * Nothing spawns the daemon with `--namespace`, so REFARM_NAMESPACE (else
 * "default") is the effective authority — the same value health and status must
 * agree on. (Previously status guessed brand.slug ?? "refarm-main", a name
 * nothing ever created.)
 */
export function resolveTractorNamespace(env = process.env): string {
	return env.REFARM_NAMESPACE?.trim() || "default";
}

/**
 * The tractor sqlite db path, mirroring what the daemon opens. The daemon
 * (scripts/tractor-start.sh) sets XDG_DATA_HOME=${REFARM_HOME:-<repo>/.refarm}/data
 * and the Rust host writes {XDG_DATA_HOME}/refarm/{namespace}.db (storage/sqlite.rs
 * db_dir). We mirror that exact base so a bare `refarm health`/`status` resolves
 * the SAME file — not ~/.local/share, which the daemon never uses under the repo
 * launcher.
 *
 * NOTE (honest divergence): the Rust db_dir also has a Windows %APPDATA% branch;
 * this resolver, like the launcher, only implements the XDG/REFARM_HOME path.
 */
export function resolveTractorDbPath(env = process.env): string {
	const base =
		env.XDG_DATA_HOME?.trim() || path.join(resolveRefarmHome(env), "data");
	return path.join(base, "refarm", `${resolveTractorNamespace(env)}.db`);
}

/**
 * A read-only NodeView over the tractor `nodes` table — or null when the db does
 * not exist (the runtime never ran) or is unreadable/locked. Read-only: it can
 * never create or mutate the host db, so an fs-only caller is never broken by a
 * missing or locked store.
 */
export function openTractorGraph(
	env = process.env,
): ReturnType<typeof createNodeView> | null {
	const dbPath = resolveTractorDbPath(env);
	if (!fs.existsSync(dbPath)) return null;
	try {
		return createNodeView(new TractorNodesReadProvider(dbPath));
	} catch {
		return null;
	}
}
