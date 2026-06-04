export const PI_AGENT_PLUGIN_ID = "@refarm/pi-agent";
export const PI_AGENT_NPM_PACKAGE = "@refarm.dev/pi-agent";
export const RUNTIME_AGENT_PLUGIN_ID = PI_AGENT_PLUGIN_ID;
export const RUNTIME_AGENT_NPM_PACKAGE = PI_AGENT_NPM_PACKAGE;
export const RUNTIME_AGENT_ERROR_PREFIXES = [
	"[runtime-agent error]",
	"[runtime-agent stub]",
	"[pi-agent erro]",
	"[pi-agent stub]",
	"[budget]",
];

const PLUGIN_ID_ALIASES = {
	"pi-agent": PI_AGENT_PLUGIN_ID,
	"pi_agent": PI_AGENT_PLUGIN_ID,
	"refarm/pi-agent": PI_AGENT_PLUGIN_ID,
	"runtime-agent": RUNTIME_AGENT_PLUGIN_ID,
	"runtime_agent": RUNTIME_AGENT_PLUGIN_ID,
	"refarm/runtime-agent": RUNTIME_AGENT_PLUGIN_ID,
	[PI_AGENT_NPM_PACKAGE]: PI_AGENT_PLUGIN_ID,
};

export function normalizePluginId(pluginId) {
	return PLUGIN_ID_ALIASES[pluginId] ?? pluginId;
}

export function isPiAgentPluginId(pluginId) {
	return normalizePluginId(pluginId) === PI_AGENT_PLUGIN_ID;
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
