import type { PluginManifest } from "@refarm.dev/plugin-manifest";

export type RuntimePluginManifest = PluginManifest;

export interface RuntimePluginInstance {
	call(fn: string, args?: unknown): Promise<unknown>;
}

export interface RuntimePluginHost {
	get(pluginId: string): RuntimePluginInstance | undefined;
	load(manifest: RuntimePluginManifest): Promise<unknown>;
}

export interface RuntimePluginRegistry {
	register(manifest: RuntimePluginManifest, sourceUrl?: string): Promise<string>;
	trust(pluginId: string): Promise<void>;
}

export type RuntimePluginReader = Pick<RuntimePluginHost, "get">;

export type RuntimePluginLoader = Pick<RuntimePluginHost, "load">;

export interface RuntimeTaskTarget {
	plugins: RuntimePluginReader;
	storeNode(node: Record<string, unknown>): Promise<void>;
}

export interface RuntimePluginLoaderTarget {
	registry: RuntimePluginRegistry;
	plugins: RuntimePluginLoader;
}

export interface RuntimeHost {
	plugins: RuntimePluginReader & RuntimePluginLoader;
	registry: RuntimePluginRegistry;
	storeNode(node: Record<string, unknown>): Promise<void>;
	queryNodes(type: string): Promise<Record<string, unknown>[]>;
	onNode(type: string, handler: (node: Record<string, unknown>) => void | Promise<void>): void;
	shutdown?: () => Promise<void>;
}
