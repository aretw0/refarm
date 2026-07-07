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

/** FS-safe charset class (no `@` `/`) — mirrors the Rust is_safe_plugin_id_token set. */
export const PLUGIN_ID_FS_SAFE_CHARS: string;
/** Command-safe charset class (permits `@` `/` `:`) — a bare command-line token. */
export const PLUGIN_ID_COMMAND_SAFE_CHARS: string;
/** Max plugin-id length — mirrors the Rust MAX_PLUGIN_ID_LEN. */
export const PLUGIN_ID_MAX_LEN: number;
/** Predicate: is `id` filesystem-safe (mirror of Rust is_safe_plugin_id_token). */
export function isFsSafeId(id: string): boolean;
/** Predicate: is `value` a bare command-safe token (needs no quoting). */
export function isCommandSafeId(value: string): boolean;
/**
 * Canonical filesystem-safe PROJECTION of a plugin id (one contained segment, no
 * path separators or `..` navigation). One-way; the true id lives in the manifest.
 */
export function pluginIdToFsToken(pluginId: string): string;
/**
 * The runtime/routing token — the last `/`-segment (`@refarm/agent`→`agent`).
 * Declared mirror of the Rust manifest_runtime_plugin_id projection.
 */
export function pluginIdRuntimeToken(id: string): string;
export function isAgentPluginId(pluginId: string): boolean;
export function isRuntimeAgentPluginId(pluginId: string): boolean;
export function isRuntimeAgentErrorContent(content: string): boolean;
export function canonicalRuntimeAgentContent(content: string): string;
