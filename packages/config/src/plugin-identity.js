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

/**
 * The single canonical FILESYSTEM-SAFE projection of a plugin id — the one place
 * a plugin id becomes a directory/file segment, for ANY consumer (the CLI, the
 * Barn, an fs/OPFS/p2p storage backend). A command-safe id (`@scope/name`) is NOT
 * filesystem-safe: the `/` would nest, and a hostile id like `@a/../../etc` fed
 * raw to `path.join(baseDir, id)` ESCAPES the base dir. This flattens every path
 * separator and drops the scope sigil so the id can only ever name ONE segment
 * inside the base:
 *   - `/` and `\` → `_`  (no nesting; `..` between separators becomes inert text)
 *   - `@` → ``           (scope sigil, cosmetic)
 *   - anything outside `[A-Za-z0-9._-]` → `_`  (no separator/metachar survives)
 *   - an all-dots token (`.`, `..`) is prefixed `_` so it can't be a relative ref
 * Idempotent; one-way (the true id lives in the manifest, not the dir name). Lives
 * beside normalizePluginId because it is the SAME concern — a projection of the
 * plugin identity — and must never be reimplemented per consumer.
 *
 * @param {string} pluginId
 * @returns {string}
 */
export function pluginIdToFsToken(pluginId) {
	const token = pluginId
		.replace(/[/\\]/g, "_")
		.replace(/@/g, "")
		.replace(/[^A-Za-z0-9._-]/g, "_");
	return /^\.+$/.test(token) ? `_${token}` : token;
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
