export const AGENT_PLUGIN_ID = "@refarm/agent";
export const AGENT_NPM_PACKAGE = "@refarm.dev/agent";
export const RUNTIME_AGENT_PLUGIN_ID = AGENT_PLUGIN_ID;
export const RUNTIME_AGENT_NPM_PACKAGE = AGENT_NPM_PACKAGE;
export const RUNTIME_AGENT_PLUGIN_DESCRIPTOR = {
	id: RUNTIME_AGENT_PLUGIN_ID,
	npmPackage: RUNTIME_AGENT_NPM_PACKAGE,
	workspaceDir: "packages/agent",
	wasmFile: "dist/agent.wasm",
	manifestFile: "dist/plugin.json",
	requiredProvides: ["integration:respond"],
};
export const REFARM_BUNDLED_PLUGIN_DESCRIPTORS = [
	RUNTIME_AGENT_PLUGIN_DESCRIPTOR,
];
export const RUNTIME_AGENT_ERROR_PREFIXES = [
	"[runtime-agent error]",
	"[runtime-agent stub]",
	"[budget]",
];

const PLUGIN_ID_ALIASES = {
	"agent": AGENT_PLUGIN_ID,
	"refarm/agent": AGENT_PLUGIN_ID,
	"runtime-agent": RUNTIME_AGENT_PLUGIN_ID,
	"runtime_agent": RUNTIME_AGENT_PLUGIN_ID,
	"refarm/runtime-agent": RUNTIME_AGENT_PLUGIN_ID,
	[AGENT_NPM_PACKAGE]: AGENT_PLUGIN_ID,
};

export function normalizePluginId(pluginId) {
	return PLUGIN_ID_ALIASES[pluginId] ?? pluginId;
}

export function isAgentPluginId(pluginId) {
	return normalizePluginId(pluginId) === AGENT_PLUGIN_ID;
}

export function isRuntimeAgentPluginId(pluginId) {
	return normalizePluginId(pluginId) === RUNTIME_AGENT_PLUGIN_ID;
}

export function isRuntimeAgentErrorContent(content) {
	return RUNTIME_AGENT_ERROR_PREFIXES.some((prefix) =>
		content.startsWith(prefix),
	);
}

// Content already uses the canonical `[runtime-agent …]` labels; the legacy
// `[pi-agent …]` translation was dropped with the pi-agent generation (fresh
// store, no pre-rename sessions to normalize). Kept as an identity passthrough so
// callers (sessions.ts) need no change, and as the seam if a future canonicaliser
// is needed.
export function canonicalRuntimeAgentContent(content) {
	return content;
}
