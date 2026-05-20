import type {
	RuntimeNode,
	RuntimePluginHandle,
} from "@refarm.dev/runtime";

export interface StudioHostTelemetryEvent {
	event: string;
	pluginId?: string;
	payload?: unknown;
}

export interface StudioHostRegistryEntry {
	status?: string;
}

export interface StudioHostRegistry {
	getPlugin?(id: string): StudioHostRegistryEntry | undefined;
}

export interface StudioHostPluginStore {
	get(pluginId: string): RuntimePluginHandle | undefined;
	getAllPlugins(): RuntimePluginHandle[];
	findByApi?(apiName: string): RuntimePluginHandle | undefined;
}

export type StudioHostPlugin = RuntimePluginHandle;

export interface StudioHost {
	logLevel?: string;
	plugins: StudioHostPluginStore;
	registry?: StudioHostRegistry;
	observe(
		handler: (event: StudioHostTelemetryEvent) => void | Promise<void>,
	): void;
	emitTelemetry(event: StudioHostTelemetryEvent): void;
	onNode(type: string, handler: (node: RuntimeNode) => void | Promise<void>): void;
	getHelpNodes(): Promise<RuntimeNode[]>;
	switchTier(tier: string): void | Promise<void>;
}

export type StudioHostNode = RuntimeNode;
