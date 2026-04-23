/**
 * installPlugin — Browser-side plugin installation
 *
 * Fetches a WASM plugin from a remote URL and caches it to OPFS.
 * After installation, the plugin's WASM is available for PluginHost.load()
 * when running in environments with OPFS support.
 */

import {
	installWasmArtifact,
	verifyBufferIntegrity,
	type BrowserRuntimeModuleMetadata,
	type PluginBinaryCacheAdapter,
	type PluginManifest,
	type WasmBinaryKind,
} from "@refarm.dev/plugin-manifest";
import {
	cachePlugin,
	cachePluginRuntimeModule,
	evictPlugin,
	getCachedPlugin,
	getPluginCachePath,
	getPluginRuntimeModuleCachePath,
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
	runtimeModuleCachePath?: string;
}

export interface BrowserRuntimeModuleInstallInput {
	url: string;
	integrity: string;
}

export interface InstallPluginOptions {
	force?: boolean;
	browserRuntimeModule?: BrowserRuntimeModuleInstallInput;
}

async function fetchBrowserRuntimeModule(
	browserRuntimeModule: BrowserRuntimeModuleInstallInput,
): Promise<{ source: string; metadata: BrowserRuntimeModuleMetadata }> {
	const response = await fetch(browserRuntimeModule.url);
	if (!response.ok) {
		throw new Error(
			`[install-plugin] Failed to fetch browser runtime module ${browserRuntimeModule.url}: ${response.statusText}`,
		);
	}

	const source = await response.text();
	const bytes = new TextEncoder().encode(source).buffer;
	await verifyBufferIntegrity(bytes, browserRuntimeModule.integrity);

	return {
		source,
		metadata: {
			url: browserRuntimeModule.url,
			integrity: browserRuntimeModule.integrity,
			format: "esm",
		},
	};
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
	options: InstallPluginOptions = {},
): Promise<InstallPluginResult> {
	const runtimeModule = options.browserRuntimeModule
		? await fetchBrowserRuntimeModule(options.browserRuntimeModule)
		: null;

	const result = await installWasmArtifact(
		{
			pluginId: manifest.id,
			wasmUrl,
			integrity: manifest.integrity ?? "",
			force: options.force,
			metadataExtensions: runtimeModule
				? { browserRuntimeModule: runtimeModule.metadata }
				: undefined,
		},
		{
			cache: OPFS_CACHE_ADAPTER,
			fetchFn: globalThis.fetch.bind(globalThis),
		},
	);

	if (runtimeModule) {
		await cachePluginRuntimeModule(manifest.id, runtimeModule.source);
	}

	return {
		...result,
		cachePath: getPluginCachePath(manifest.id),
		runtimeModuleCachePath: runtimeModule
			? getPluginRuntimeModuleCachePath(manifest.id)
			: undefined,
	};
}
