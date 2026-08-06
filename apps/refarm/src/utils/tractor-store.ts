import { createSidecarGraphClient, type SidecarGraphClient } from "@refarm.dev/sidecar-client";
import { createNodeView, type NodeView } from "@refarm.dev/storage-node-view";
import fs from "node:fs";
import path from "node:path";
import { resolveRefarmHome } from "./refarm-home.js";
import { resolveRuntimeSidecarUrl } from "./runtime-config.js";

export const DIRECT_SQLITE_GRAPH_ENV_VAR = "REFARM_TRACTOR_GRAPH_DIRECT_SQLITE";

export type TractorGraph = SidecarGraphClient;

export interface OpenTractorGraphOptions {
	fetch?: typeof fetch;
	directSqlite?: boolean;
}

/**
 * App-owned read access to the tractor host's local sovereign graph. The
 * reusable sidecar graph client lives in @refarm.dev/sidecar-client; this module
 * only decides which runtime URL to use and when a local direct-SQLite fallback
 * is explicitly requested.
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
	const base = env.XDG_DATA_HOME?.trim() || path.join(resolveRefarmHome(env), "data");
	return path.join(base, "refarm", `${resolveTractorNamespace(env)}.db`);
}

/**
 * A read-only runtime graph client. Distributed/normal CLI code talks to the
 * sidecar, not to `node:sqlite`, so the packaged CLI stays off experimental Node
 * APIs and the runtime owns its storage implementation.
 */
export async function openTractorGraph(
	env = process.env,
	options: OpenTractorGraphOptions = {},
): Promise<TractorGraph | null> {
	if (options.directSqlite ?? directSqliteGraphEnabled(env)) {
		return openDirectTractorGraph(env);
	}
	return createRuntimeTractorGraph(env, options);
}

/**
 * Explicit direct-SQLite fallback for local scripts/dev diagnostics. This is not
 * the distributed default because importing `@refarm.dev/storage-sqlite/node`
 * loads Node's experimental `node:sqlite` API.
 */
export async function openDirectTractorGraph(env = process.env): Promise<TractorGraph | null> {
	const dbPath = resolveTractorDbPath(env);
	if (!fs.existsSync(dbPath)) return null;
	try {
		const { TractorNodesReadProvider } = await import("@refarm.dev/storage-sqlite/node");
		return tractorGraphFromNodeView(createNodeView(new TractorNodesReadProvider(dbPath)));
	} catch {
		return null;
	}
}

/**
 * Adapt a `NodeView` (a plain fs/sqlite record scan, no server-side paging —
 * `packages/storage-node-view/src/node-view.ts`) to the sidecar client's
 * `SidecarGraphClient` shape. Unlike the HTTP sidecar's `GET /nodes`, this
 * path has no response ceiling and no partial page: `NodeView.queryNodes`
 * always reads every stored row of the requested `@type` in one pass. So
 * `stored`/`truncated` ARE knowable here, unlike the sidecar's unknown-gap
 * case — every row was read, none was left out. `stored: nodes.length` and
 * `truncated: false` are correct BY CONSTRUCTION for this backend, not a
 * default standing in for an unknown answer (contrast
 * `docs/SOVEREIGN_RECORD_ORDERING.md`'s "absent means absent" — that rule
 * governs the sidecar HTTP path, where completeness genuinely cannot be
 * seen from the client).
 */
function tractorGraphFromNodeView(view: NodeView): TractorGraph {
	return {
		getNode: (id) => view.getNode(id),
		async queryNodes(type) {
			const nodes = await view.queryNodes(type);
			return { nodes, stored: nodes.length, truncated: false };
		},
	};
}

function directSqliteGraphEnabled(env: NodeJS.ProcessEnv): boolean {
	const value = env[DIRECT_SQLITE_GRAPH_ENV_VAR]?.trim().toLowerCase();
	return value === "1" || value === "true" || value === "yes";
}

function createRuntimeTractorGraph(
	env: NodeJS.ProcessEnv,
	options: OpenTractorGraphOptions,
): TractorGraph {
	const baseUrl = resolveRuntimeSidecarUrl({ env }).value;
	return createSidecarGraphClient(baseUrl, { env, fetch: options.fetch });
}
