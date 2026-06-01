export const PI_AGENT_PLUGIN_ID = "@refarm/pi-agent";
export const PI_AGENT_NPM_PACKAGE = "@refarm.dev/pi-agent";

const PLUGIN_ID_ALIASES = {
	"pi-agent": PI_AGENT_PLUGIN_ID,
	"pi_agent": PI_AGENT_PLUGIN_ID,
	"refarm/pi-agent": PI_AGENT_PLUGIN_ID,
	[PI_AGENT_NPM_PACKAGE]: PI_AGENT_PLUGIN_ID,
};

export function normalizePluginId(pluginId) {
	return PLUGIN_ID_ALIASES[pluginId] ?? pluginId;
}

export function isPiAgentPluginId(pluginId) {
	return normalizePluginId(pluginId) === PI_AGENT_PLUGIN_ID;
}
