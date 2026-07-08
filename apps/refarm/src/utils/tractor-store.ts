import { fetchSidecarWithTimeout } from "@refarm.dev/sidecar-client";
import { createNodeView } from "@refarm.dev/storage-node-view";
import fs from "node:fs";
import path from "node:path";
import { resolveRefarmHome } from "./refarm-home.js";
import { resolveRuntimeSidecarUrl } from "./runtime-config.js";

export const DIRECT_SQLITE_GRAPH_ENV_VAR = "REFARM_TRACTOR_GRAPH_DIRECT_SQLITE";

export interface TractorGraph {
	getNode(id: string): Promise<Record<string, unknown> | null>;
	queryNodes(type: string): Promise<Record<string, unknown>[]>;
}

export interface OpenTractorGraphOptions {
	fetch?: typeof fetch;
	directSqlite?: boolean;
}

/**
 * Shared read access to the tractor host's local sovereign graph — one source of
 * truth so every command (health, status, future readers) resolves the SAME
 * runtime graph the daemon owns, instead of each guessing its own storage path.
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
export async function openDirectTractorGraph(
	env = process.env,
): Promise<TractorGraph | null> {
	const dbPath = resolveTractorDbPath(env);
	if (!fs.existsSync(dbPath)) return null;
	try {
		const { TractorNodesReadProvider } = await import(
			"@refarm.dev/storage-sqlite/node"
		);
		return createNodeView(new TractorNodesReadProvider(dbPath));
	} catch {
		return null;
	}
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
	const fetchImpl = options.fetch;
	return {
		async getNode(id: string): Promise<Record<string, unknown> | null> {
			const response = await fetchSidecarWithTimeout(
				`${baseUrl}/nodes/${encodeURIComponent(id)}`,
				{},
				{ env, fetch: fetchImpl },
			);
			if (response.status === 404) return null;
			if (!response.ok) throw new Error(`sidecar graph HTTP ${response.status}`);
			const body = asObject(await response.json());
			const node = asGraphNode(body?.node);
			if (!node) throw new Error("sidecar graph response missing node");
			return node;
		},
		async queryNodes(type: string): Promise<Record<string, unknown>[]> {
			const response = await fetchSidecarWithTimeout(
				`${baseUrl}/nodes?type=${encodeURIComponent(type)}&limit=100`,
				{},
				{ env, fetch: fetchImpl },
			);
			if (!response.ok) throw new Error(`sidecar graph HTTP ${response.status}`);
			const body = asObject(await response.json());
			const nodes = Array.isArray(body?.nodes) ? body.nodes : null;
			if (!nodes) throw new Error("sidecar graph response missing nodes");
			return nodes.map((node) => {
				const graphNode = asGraphNode(node);
				if (!graphNode) throw new Error("sidecar graph response includes malformed node");
				return graphNode;
			});
		},
	};
}

function asObject(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function asGraphNode(value: unknown): Record<string, unknown> | null {
	const node = asObject(value);
	if (!node) return null;
	return typeof node["@id"] === "string" && typeof node["@type"] === "string"
		? node
		: null;
}
