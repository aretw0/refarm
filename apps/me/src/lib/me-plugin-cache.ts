import {
	evictPlugin,
	getCachedPlugin,
	installPlugin,
} from "@refarm.dev/tractor/browser";

type RefarmMePluginManifest = Parameters<typeof installPlugin>[0];

export interface RefarmMePluginCacheProofInput {
	manifest: RefarmMePluginManifest;
	wasmUrl: string;
	force?: boolean;
}

export interface RefarmMePluginCacheProofResult {
	pluginId: string;
	cached: boolean;
	byteLength: number;
	cachedByteLength: number;
	cachePath: string;
	persisted: boolean;
	wasmHash: string;
}

export async function proveRefarmMePluginCache(
	input: RefarmMePluginCacheProofInput,
): Promise<RefarmMePluginCacheProofResult> {
	const result = await installPlugin(input.manifest, input.wasmUrl, {
		force: input.force,
	});
	const cached = await getCachedPlugin(input.manifest.id);
	const cachedByteLength = cached?.byteLength ?? 0;

	return {
		pluginId: result.pluginId,
		cached: result.cached,
		byteLength: result.byteLength,
		cachedByteLength,
		cachePath: result.cachePath,
		persisted: cachedByteLength === result.byteLength,
		wasmHash: result.wasmHash,
	};
}

export async function evictRefarmMePluginCache(pluginId: string): Promise<void> {
	await evictPlugin(pluginId);
}
