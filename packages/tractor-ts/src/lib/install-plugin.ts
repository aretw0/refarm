/**
 * installPlugin — Browser-side plugin installation
 *
 * Fetches a WASM plugin from a remote URL and caches it to OPFS.
 * After installation, the plugin's WASM is available for PluginHost.load()
 * when running in environments with OPFS support.
 */

import {
	installWasmArtifact,
	type PluginBinaryCacheAdapter,
	type PluginManifest,
	type WasmBinaryKind,
} from "@refarm.dev/plugin-manifest";
import {
	cachePlugin,
	evictPlugin,
	getCachedPlugin,
	getPluginCachePath,
} from "./opfs-plugin-cache";

const OPFS_CACHE_ADAPTER: PluginBinaryCacheAdapter = {
	get: getCachedPlugin,
	set: cachePlugin,
	evict: evictPlugin,
};

export interface InstallPluginResult {
	pluginId: string;
	wasmUrl: string;
	cached: boolean;
	byteLength: number;
	wasmHash: string;
	artifactKind: WasmBinaryKind;
	cachePath: string;
}

/**
 * Install a plugin by fetching its WASM and caching it to OPFS.
 *
 * If the plugin is already cached, returns the cached version without re-fetching.
 * Pass force: true to bypass the cache and re-fetch.
 */
export async function installPlugin(
	manifest: PluginManifest,
	wasmUrl: string,
	options: { force?: boolean } = {},
): Promise<InstallPluginResult> {
	const result = await installWasmArtifact(
		{
			pluginId: manifest.id,
			wasmUrl,
			integrity: manifest.integrity ?? "",
			force: options.force,
		},
		{
			cache: OPFS_CACHE_ADAPTER,
			fetchFn: globalThis.fetch.bind(globalThis),
		},
	);

	return {
		...result,
		cachePath: getPluginCachePath(manifest.id),
	};
}
