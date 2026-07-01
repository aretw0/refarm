import type { RuntimePluginHandle } from "@refarm.dev/runtime";
import {
	installPlugin,
	type BrowserRuntimeModuleInstallInput,
	type InstallPluginResult,
} from "@refarm.dev/tractor/browser";

export type RefarmMeContentPluginManifest = Parameters<typeof installPlugin>[0];

export interface RefarmMeContentPluginInstallInput {
	manifest: RefarmMeContentPluginManifest;
	wasmUrl?: string;
	browserRuntimeModule?: BrowserRuntimeModuleInstallInput;
	force?: boolean;
	sourceUrl?: string;
}

export interface RefarmMeContentPluginInstallResult {
	pluginId: string;
	cached: boolean;
	wasmHash: string;
	byteLength: number;
	registryStatus: string | undefined;
	instance: RuntimePluginHandle;
}

interface RefarmMeContentPluginRegistry {
	register(
		manifest: RefarmMeContentPluginManifest,
		sourceUrl?: string,
	): Promise<string> | string;
	trust(id: string): Promise<void> | void;
	activatePlugin(id: string): Promise<void> | void;
	getPlugin(id: string): { status?: string } | undefined;
}

interface RefarmMeContentPluginHost {
	load(
		manifest: RefarmMeContentPluginManifest,
		wasmHash?: string,
	): Promise<RuntimePluginHandle>;
}

export interface RefarmMeContentPluginTractor {
	registry: RefarmMeContentPluginRegistry;
	plugins: RefarmMeContentPluginHost;
	emitTelemetry?(event: {
		event: string;
		pluginId?: string;
		payload?: unknown;
	}): void;
}

export async function installRefarmMeContentPlugin(
	tractor: RefarmMeContentPluginTractor,
	input: RefarmMeContentPluginInstallInput,
): Promise<RefarmMeContentPluginInstallResult> {
	const wasmUrl = input.wasmUrl ?? input.manifest.entry;
	const install = await installPlugin(input.manifest, wasmUrl, {
		browserRuntimeModule: input.browserRuntimeModule,
		force: input.force,
	});

	await tractor.registry.register(
		input.manifest,
		input.sourceUrl ?? wasmUrl,
	);
	await tractor.registry.trust(input.manifest.id);
	await tractor.registry.activatePlugin(input.manifest.id);
	const instance = await tractor.plugins.load(input.manifest, install.wasmHash);
	const registryStatus = tractor.registry.getPlugin(input.manifest.id)?.status;

	emitRefarmMeContentPluginTelemetry(tractor, input.manifest.id, install, {
		registryStatus,
	});

	return {
		pluginId: install.pluginId,
		cached: install.cached,
		wasmHash: install.wasmHash,
		byteLength: install.byteLength,
		registryStatus,
		instance,
	};
}

export async function installRefarmMeContentPlugins(
	tractor: RefarmMeContentPluginTractor,
	inputs: readonly RefarmMeContentPluginInstallInput[] = [],
): Promise<RefarmMeContentPluginInstallResult[]> {
	const installed: RefarmMeContentPluginInstallResult[] = [];
	for (const input of inputs) {
		installed.push(await installRefarmMeContentPlugin(tractor, input));
	}
	return installed;
}

function emitRefarmMeContentPluginTelemetry(
	tractor: RefarmMeContentPluginTractor,
	pluginId: string,
	install: InstallPluginResult,
	payload: { registryStatus: string | undefined },
): void {
	tractor.emitTelemetry?.({
		event: "me:content_plugin_installed",
		pluginId,
		payload: {
			cached: install.cached,
			byteLength: install.byteLength,
			wasmHash: install.wasmHash,
			artifactKind: install.artifactKind,
			registryStatus: payload.registryStatus,
		},
	});
}
