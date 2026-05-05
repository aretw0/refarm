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

export interface PluginEntry {
	id: string;
	url: string;
	integrity: string;
	status: "pending" | "installed" | "error";
	installedAt: number;
	cacheStatus: "hit" | "miss";
	wasmHash: string;
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

	constructor() {
		console.log("[barn] Barn initialized.");

		this.cacheAdapter = {
			get: async (pluginId: string) =>
				this._cacheByPluginId.get(pluginId)?.bytes ?? null,
			set: async (
				pluginId: string,
				bytes: ArrayBuffer,
				metadata?: PluginArtifactMetadata,
			) => {
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
		return entry;
	}

	async listPlugins(): Promise<PluginEntry[]> {
		return Array.from(this._inventory.values());
	}

	async uninstallPlugin(id: string): Promise<void> {
		if (!this._inventory.has(id)) {
			throw new Error(`Plugin not found: ${id}`);
		}
		this._inventory.delete(id);
	}
}
