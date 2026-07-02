export const AGENT_PLUGIN_ID: "@refarm/agent";
export const AGENT_NPM_PACKAGE: "@refarm.dev/agent";
export const RUNTIME_AGENT_PLUGIN_ID: typeof AGENT_PLUGIN_ID;
export const RUNTIME_AGENT_NPM_PACKAGE: typeof AGENT_NPM_PACKAGE;

export interface RefarmBundledPluginDescriptor {
	readonly id: string;
	readonly npmPackage: string;
	readonly workspaceDir: string;
	readonly wasmFile: string;
	readonly manifestFile: string;
	readonly requiredProvides: readonly string[];
}

export const RUNTIME_AGENT_PLUGIN_DESCRIPTOR: RefarmBundledPluginDescriptor;
export const REFARM_BUNDLED_PLUGIN_DESCRIPTORS: readonly RefarmBundledPluginDescriptor[];
export const RUNTIME_AGENT_ERROR_PREFIXES: readonly string[];

export function normalizePluginId(pluginId: string): string;
export function isAgentPluginId(pluginId: string): boolean;
export function isRuntimeAgentPluginId(pluginId: string): boolean;
export function isRuntimeAgentErrorContent(content: string): boolean;
export function canonicalRuntimeAgentContent(content: string): string;
