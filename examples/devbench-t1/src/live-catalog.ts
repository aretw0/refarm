import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type CapabilityInput,
} from "@refarm.dev/capability-host";
import { Barn } from "@refarm.dev/barn";
import { renderTableHtml } from "@refarm.dev/capability-homestead-surface";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { computeIntegrity, fileFetch } from "./extension-lifecycle.js";

/**
 * PLUGIN CATALOG — the sovereign inventory of what is installed, verified.
 *
 * The Barn installs each plugin by fetching its bytes, re-verifying the sha256 integrity, and
 * caching it; `listPlugins()` returns the inventory (id, integrity, cacheStatus, wasmHash). This
 * verb installs the real built plugins through the Barn and lists the catalog — proving
 * integrity-verify on install AND cache dedup (a re-install of the same bytes is a `cacheStatus:
 * "hit"`). Offline: the bytes are read from the local dist via a file:// fetch, no daemon, no net.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** The real, built plugins whose catalog we list. */
export function catalogPlugins(): Array<{ name: string; path: string }> {
	return [
		{ name: "source-provider", path: resolve(REPO_ROOT, "packages/source-provider-ref/dist/source_provider.wasm") },
		{ name: "agent", path: resolve(REPO_ROOT, "packages/agent/dist/agent.wasm") },
		{ name: "delegate", path: resolve(REPO_ROOT, "packages/delegate/dist/plugin.wasm") },
	];
}

export interface CatalogEntry {
	name: string;
	id: string;
	integrity: string;
	wasmHash: string;
	cacheStatus: "hit" | "miss";
	status: string;
}

export interface CatalogReport {
	installed: CatalogEntry[];
	/** A re-install of the first plugin — proves the content cache dedups (cacheStatus "hit"). */
	reinstallCacheStatus?: "hit" | "miss";
}

/**
 * Install each built plugin through the Barn (fetch + sha256 verify + cache) and return the
 * inventory. Re-installs the first to demonstrate the cache hit. PURE of I/O beyond reading the
 * local dist bytes (no daemon, no network — a file:// fetch is injected).
 */
export async function runCatalog(plugins = catalogPlugins()): Promise<CatalogReport> {
	const barn = new Barn({ fetchFn: fileFetch() });
	const installed: CatalogEntry[] = [];
	for (const p of plugins) {
		const integrity = computeIntegrity(readFileSync(p.path));
		const entry = await barn.installPlugin(pathToFileURL(p.path).href, integrity);
		installed.push({
			name: p.name,
			id: entry.id,
			integrity: entry.integrity,
			wasmHash: entry.wasmHash,
			cacheStatus: entry.cacheStatus,
			status: entry.status,
		});
	}
	// Re-install the first plugin — the Barn's content cache should report a hit.
	let reinstallCacheStatus: "hit" | "miss" | undefined;
	if (plugins[0]) {
		const first = plugins[0];
		const integrity = computeIntegrity(readFileSync(first.path));
		const re = await barn.installPlugin(pathToFileURL(first.path).href, integrity);
		reinstallCacheStatus = re.cacheStatus;
	}
	// The inventory the Barn holds — the sovereign catalog.
	const catalog = await barn.listPlugins();
	// Reconcile the reported names onto the listed inventory (listPlugins loses the display name).
	const byId = new Map(installed.map((e) => [e.id, e.name]));
	const inventory = catalog.map((e) => ({
		name: byId.get(e.id) ?? e.id,
		id: e.id,
		integrity: e.integrity,
		wasmHash: e.wasmHash,
		cacheStatus: e.cacheStatus,
		status: e.status,
	}));
	return { installed: inventory, ...(reinstallCacheStatus ? { reinstallCacheStatus } : {}) };
}

/**
 * `plugin-catalog` — install the real built plugins through the Barn and list the sovereign
 * inventory (id, integrity, wasmHash, cacheStatus). Proves integrity-verify on install and cache
 * dedup on re-install. Offline (file:// fetch, no daemon).
 */
export function createPluginCatalogCapability(): CapabilityDescriptor {
	return {
		name: "plugin-catalog",
		summary: "Install the built plugins through the Barn and list the verified inventory (integrity + cache)",
		transports: { http: { path: "/plugin/catalog" } },
		renderers: { tui: { section: "extension" }, web: { route: "/plugin-catalog", icon: "package" }, ide: { command: "dgk.plugin-catalog" } },
		async run(_input: CapabilityInput): Promise<CapabilityEnvelope> {
			const plugins = catalogPlugins();
			const missing = plugins.filter((p) => !existsSync(p.path)).map((p) => p.name);
			if (missing.length > 0) {
				return buildJsonErrorEnvelope({
					command: "plugin-catalog",
					operation: "plugin-catalog",
					error: "artifacts_missing",
					message: `Build the plugins first (missing: ${missing.join(", ")}).`,
					nextAction:
						"pnpm --filter @refarm.dev/source-provider-ref run build:plugin && pnpm --filter @refarm.dev/agent run build:wasm && pnpm --filter @refarm.dev/delegate run build:wasm",
				});
			}
			try {
				const report = await runCatalog(plugins);
				return buildJsonSuccessEnvelope({
					command: "plugin-catalog",
					operation: "plugin-catalog",
					nextCommand: "dgk extension-lifecycle",
					nextCommands: ["dgk extension-lifecycle"],
					extra: {
						count: report.installed.length,
						// The sovereign inventory — each plugin verified (integrity) + fingerprinted (wasmHash).
						catalog: report.installed,
						// The content cache dedups: a re-install of the same bytes is a hit.
						reinstallCacheStatus: report.reinstallCacheStatus,
						source: "the Barn (@refarm.dev/barn) — fetch + sha256 verify + cache; listPlugins() inventory",
						// The catalog as an accessible web <table> — the web twin of the TUI renderTable.
						html: renderTableHtml(
							[
								{ key: "name", header: "Plugin" },
								{ key: "cacheStatus", header: "Cache" },
								{ key: "integrity", header: "Integrity (sha256)" },
							],
							report.installed,
							{ caption: "Sovereign plugin catalog — Barn-verified (integrity + cache)" },
						),
					},
				});
			} catch (error) {
				return buildJsonErrorEnvelope({
					command: "plugin-catalog",
					operation: "plugin-catalog",
					error: "catalog_failed",
					message: error instanceof Error ? error.message : String(error),
					nextAction: "Check the plugin artifacts are built and readable.",
				});
			}
		},
	};
}
