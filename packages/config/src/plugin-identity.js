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
	"[pi-agent erro]",
	"[pi-agent stub]",
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

export function canonicalRuntimeAgentContent(content) {
	if (content.startsWith("[pi-agent erro]")) {
		return `[runtime-agent error]${content.slice("[pi-agent erro]".length)}`;
	}
	if (content.startsWith("[pi-agent stub]")) {
		return `[runtime-agent stub]${content.slice("[pi-agent stub]".length)}`;
	}
	return content;
}
