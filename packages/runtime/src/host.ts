import type { PluginManifest } from "@refarm.dev/plugin-manifest";

export type RuntimeNode = Record<string, unknown>;

export interface RuntimeTelemetryEvent {
	event: string;
	pluginId?: string;
	payload?: unknown;
	[key: string]: unknown;
}

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
	storeNode(node: RuntimeNode): Promise<void>;
}

export interface RuntimePluginLoaderTarget {
	registry: RuntimePluginRegistry;
	plugins: RuntimePluginLoader;
}

export interface RuntimeHost {
	plugins: RuntimePluginReader & RuntimePluginLoader;
	registry: RuntimePluginRegistry;
	storeNode(node: RuntimeNode): Promise<void>;
	queryNodes<T extends RuntimeNode = RuntimeNode>(type: string): Promise<T[]>;
	onNode(type: string, handler: (node: RuntimeNode) => void | Promise<void>): void;
	shutdown?: () => Promise<void>;
}

export interface RuntimeQueryTarget {
	queryNodes<T extends RuntimeNode = RuntimeNode>(type: string): Promise<T[]>;
}

export interface RuntimeTelemetryTarget {
	emitTelemetry(event: RuntimeTelemetryEvent): void;
}

export interface RuntimeObserverTarget {
	observe(handler: (event: RuntimeTelemetryEvent) => void | Promise<void>): void;
}

export interface RuntimeTierTarget {
	switchTier(tier: string): void | Promise<void>;
}

export interface RuntimePluginStateTarget {
	setPluginState(pluginId: string, state: string): void | Promise<void>;
}
