/**
 * Barn (O Celeiro) — Machinery Manager for Refarm.
 *
 * Responsibilities:
 * 1. Plugin Lifecycle Management (Install/Uninstall).
 * 2. Inventory of available and installed plugins.
 * 3. Delegation to canonical install/cache/verify contract.
 */

import {
	installWasmArtifact,
	type PluginArtifactMetadata,
	type PluginBinaryCacheAdapter,
} from "@refarm.dev/plugin-manifest";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export interface PluginEntry {
	id: string;
	url: string;
	integrity: string;
	status: "pending" | "installed" | "error";
	installedAt: number;
	cacheStatus: "hit" | "miss";
	wasmHash: string;
}

/**
 * A minimal node-graph ledger the Barn writes its install inventory into.
 *
 * Structurally satisfied by `@refarm.dev/storage-node-view`'s NodeView, but the
 * Barn depends only on this shape — never on a concrete backend. The host
 * injects a ledger (fs, memory, sqlite… resolved by environment); the Barn only
 * intends persistence. An install record IS a node (`refarm:PluginCatalogEntry`,
 * see docs/SCHEMA.md), so it stores as one. When no ledger is injected, the Barn
 * falls back to an in-memory Map (unchanged legacy behaviour).
 */
export interface PluginLedgerNode {
	"@type": string;
	"@id": string;
	[key: string]: unknown;
}

export interface PluginLedger {
	storeNode(node: PluginLedgerNode): Promise<void>;
	getNode(id: string): Promise<PluginLedgerNode | null>;
	queryNodes(type: string): Promise<PluginLedgerNode[]>;
	deleteNode(id: string): Promise<void>;
}

/** JSON-LD @type for a Barn install record (docs/SCHEMA.md PluginCatalogEntry). */
const PLUGIN_CATALOG_TYPE = "SoftwareApplication";

function pluginEntryToNode(entry: PluginEntry): PluginLedgerNode {
	return {
		"@context": "https://schema.org/",
		"@type": PLUGIN_CATALOG_TYPE,
		"@id": entry.id,
		installUrl: entry.url,
		sha256Integrity: entry.integrity,
		"refarm:status": entry.status,
		"installedAt": entry.installedAt,
		"cacheStatus": entry.cacheStatus,
		"wasmHash": entry.wasmHash,
	};
}

function nodeToPluginEntry(node: PluginLedgerNode): PluginEntry {
	return {
		id: node["@id"],
		url: String(node.installUrl ?? ""),
		integrity: String(node.sha256Integrity ?? ""),
		status: (node["refarm:status"] as PluginEntry["status"]) ?? "installed",
		installedAt: Number(node["installedAt"] ?? 0),
		cacheStatus: (node["cacheStatus"] as PluginEntry["cacheStatus"]) ?? "miss",
		wasmHash: String(node["wasmHash"] ?? ""),
	};
}

export type PluginPackageSource = "node_modules" | "workspace" | "unresolved";

export interface PluginPackageResolution {
	source: Exclude<PluginPackageSource, "unresolved">;
	pkgDir: string;
}

export interface PluginPackageDescriptor {
	npmPackage: string;
	workspaceDir?: string;
}

export function resolvePluginPackageFromNodeModules(
	packageName: string,
	options: { baseUrl?: string } = {},
): PluginPackageResolution | null {
	try {
		const require = createRequire(options.baseUrl ?? import.meta.url);
		const pkgJsonPath = require.resolve(`${packageName}/package.json`);
		return { source: "node_modules", pkgDir: path.dirname(pkgJsonPath) };
	} catch {
		return null;
	}
}

export function resolveWorkspacePluginPackage(
	plugin: PluginPackageDescriptor,
	options: { cwd?: string } = {},
): PluginPackageResolution | null {
	if (!plugin.workspaceDir) return null;
	let current = options.cwd ?? process.cwd();
	while (true) {
		const pkgDir = path.join(current, plugin.workspaceDir);
		const pkgJsonPath = path.join(pkgDir, "package.json");
		if (existsSync(pkgJsonPath)) {
			try {
				const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as { name?: string };
				if (pkgJson.name === plugin.npmPackage) return { source: "workspace", pkgDir };
			} catch {
				return null;
			}
		}
		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

export function resolvePluginPackage(
	plugin: PluginPackageDescriptor,
	options: { cwd?: string; baseUrl?: string } = {},
): PluginPackageResolution | null {
	return (
		resolvePluginPackageFromNodeModules(plugin.npmPackage, options) ??
		resolveWorkspacePluginPackage(plugin, options)
	);
}

type CachedBinary = {
	bytes: ArrayBuffer;
	metadata?: PluginArtifactMetadata;
};

export class Barn {
	private _inventory: Map<string, PluginEntry> = new Map();
	private _cacheByPluginId: Map<string, CachedBinary> = new Map();
	private _pluginIdByUrl: Map<string, string> = new Map();
	private readonly cacheAdapter: PluginBinaryCacheAdapter;
	/** Optional durable install-ledger (node graph). Absent → in-memory only. */
	private readonly ledger: PluginLedger | null;

	constructor(options: { ledger?: PluginLedger } = {}) {
		console.log("[barn] Barn initialized.");
		this.ledger = options.ledger ?? null;

		this.cacheAdapter = {
			get: async (pluginId: string) => this._cacheByPluginId.get(pluginId)?.bytes ?? null,
			set: async (pluginId: string, bytes: ArrayBuffer, metadata?: PluginArtifactMetadata) => {
				this._cacheByPluginId.set(pluginId, { bytes, metadata });
			},
			evict: async (pluginId: string) => {
				this._cacheByPluginId.delete(pluginId);
			},
		};
	}

	private buildPluginId(url: string): string {
		const baseSlug =
			url
				.toLowerCase()
				.replace(/^https?:\/\//, "")
				.replace(/\.wasm$/i, "")
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-+|-+$/g, "")
				.slice(0, 48) || "plugin";

		let hash = 2166136261;
		for (let i = 0; i < url.length; i += 1) {
			hash ^= url.charCodeAt(i);
			hash = Math.imul(hash, 16777619);
		}
		const suffix = (hash >>> 0).toString(16).padStart(8, "0");

		return `urn:refarm:plugin:${baseSlug}-${suffix}`;
	}

	private resolvePluginId(url: string, explicitPluginId?: string): string {
		if (explicitPluginId) return explicitPluginId;
		const known = this._pluginIdByUrl.get(url);
		if (known) return known;
		return this.buildPluginId(url);
	}

	async installPlugin(
		url: string,
		integrity: string,
		options: { pluginId?: string; force?: boolean } = {},
	): Promise<PluginEntry> {
		const pluginId = this.resolvePluginId(url, options.pluginId);
		const installResult = await installWasmArtifact(
			{
				pluginId,
				wasmUrl: url,
				integrity,
				force: options.force,
			},
			{
				cache: this.cacheAdapter,
				fetchFn: globalThis.fetch.bind(globalThis),
			},
		);

		this._pluginIdByUrl.set(url, pluginId);

		const entry: PluginEntry = {
			id: pluginId,
			url,
			integrity,
			status: "installed",
			installedAt: Date.now(),
			cacheStatus: installResult.cached ? "hit" : "miss",
			wasmHash: installResult.wasmHash,
		};

		this._inventory.set(pluginId, entry);
		// Persist durably when a ledger is injected; the record IS a node.
		if (this.ledger) {
			await this.ledger.storeNode(pluginEntryToNode(entry));
		}
		return entry;
	}

	async listPlugins(): Promise<PluginEntry[]> {
		if (this.ledger) {
			const nodes = await this.ledger.queryNodes(PLUGIN_CATALOG_TYPE);
			return nodes.map(nodeToPluginEntry);
		}
		return Array.from(this._inventory.values());
	}

	async uninstallPlugin(id: string): Promise<void> {
		if (this.ledger) {
			const existing = await this.ledger.getNode(id);
			if (!existing) {
				throw new Error(`Plugin not found: ${id}`);
			}
			await this.ledger.deleteNode(id);
			this._inventory.delete(id);
			return;
		}
		if (!this._inventory.has(id)) {
			throw new Error(`Plugin not found: ${id}`);
		}
		this._inventory.delete(id);
	}
}
