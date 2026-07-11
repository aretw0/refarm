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
// The plugins bundled with the runtime by default — auto-installed at boot. AGNOSTIC:
// this is the generic config package, so no product name in the identifier (a white-label
// app brands it on re-export). Today it is just the runtime agent; an app extends the set
// via `config.plugins.bundled` and, for the agent's own cut, via AGENT_CORE_BUNDLE below.
export const BUNDLED_PLUGIN_DESCRIPTORS = [RUNTIME_AGENT_PLUGIN_DESCRIPTOR];

// The NAMED agent core-plugin cut: the minimal agent + the plugins that extend IT (via
// capability-tools / agent events), curated as a unit. `corePlugins` is empty until the
// first is extracted (LSP code-ops). The agent stays `requires: []` — these AMPLIFY it,
// they are not boot dependencies; naming the group makes the cut visible and curatable.
export const AGENT_CORE_BUNDLE = {
	agent: RUNTIME_AGENT_PLUGIN_DESCRIPTOR,
	corePlugins: [],
};
export const RUNTIME_AGENT_ERROR_PREFIXES = [
	"[runtime-agent error]",
	"[runtime-agent stub]",
	"[budget]",
];

const PLUGIN_ID_ALIASES = {
	agent: AGENT_PLUGIN_ID,
	"refarm/agent": AGENT_PLUGIN_ID,
	"runtime-agent": RUNTIME_AGENT_PLUGIN_ID,
	runtime_agent: RUNTIME_AGENT_PLUGIN_ID,
	"refarm/runtime-agent": RUNTIME_AGENT_PLUGIN_ID,
	[AGENT_NPM_PACKAGE]: AGENT_PLUGIN_ID,
};

export function normalizePluginId(pluginId) {
	return PLUGIN_ID_ALIASES[pluginId] ?? pluginId;
}

// ── The plugin-id charset contract (single source of truth) ──────────────────
//
// A plugin id has TWO safe-charset notions and THREE projections of one input
// (`@scope/name`). Declaring them ONCE here — and mirroring them in the Rust host
// via a CI guard (scripts/ci/check-plugin-id-charset.mjs) — is what keeps RS↔TS
// from drifting. No consumer inlines an id regex; they import these.
//
//   - FS-SAFE charset (no `@` `/`): a filesystem path segment. Mirrors the Rust
//     `is_safe_plugin_id_token` charset (policy_and_fs.rs). Used by pluginIdToFsToken.
//   - COMMAND-SAFE charset (permits `@` `/` `:`): a bare token on a command line.
//     Used by the handoff quoter — a value matching it never needs quoting.
//
// The three projections are DISTINCT and must stay so:
//   - pluginIdToFsToken   — FLATTEN (`@refarm/agent`→`refarm_agent`), a path segment.
//   - pluginIdRuntimeToken — LAST-SEGMENT (`@refarm/agent`→`agent`), the routing /
//     trust-grant identity. Mirrors Rust `manifest_runtime_plugin_id`; the Rust host
//     keys trust grants + channels on it, so it is NOT the same as the fs flatten.
//   - isFsSafeId          — PREDICATE (validate, don't rewrite). Mirrors Rust.
export const PLUGIN_ID_FS_SAFE_CHARS = "A-Za-z0-9._-";
export const PLUGIN_ID_COMMAND_SAFE_CHARS = "A-Za-z0-9._:@/\\-";
export const PLUGIN_ID_MAX_LEN = 128;

const FS_SAFE_RE = new RegExp(`^[${PLUGIN_ID_FS_SAFE_CHARS}]+$`);
const NON_FS_SAFE_RE = new RegExp(`[^${PLUGIN_ID_FS_SAFE_CHARS}]`, "g");
const COMMAND_SAFE_RE = new RegExp(`^[${PLUGIN_ID_COMMAND_SAFE_CHARS}]+$`);

/**
 * Whether `id` is a filesystem-safe token — the exact mirror of the Rust
 * `is_safe_plugin_id_token` predicate (length + fs-safe charset, no `@` `/`). The
 * CI guard fails if this and the Rust definition disagree.
 * @param {string} id
 * @returns {boolean}
 */
export function isFsSafeId(id) {
	return id.length <= PLUGIN_ID_MAX_LEN && FS_SAFE_RE.test(id);
}

/**
 * Whether `value` is command-safe (a bare command-line token that needs no
 * quoting). The single definition the handoff quoter and the package-manager
 * arg-check both derive from.
 * @param {string} value
 * @returns {boolean}
 */
export function isCommandSafeId(value) {
	return COMMAND_SAFE_RE.test(value);
}

/**
 * The runtime/routing token — the LAST `/`-segment of a plugin id
 * (`@refarm/agent`→`agent`). Declared mirror of the Rust `manifest_runtime_plugin_id`
 * projection (env_and_runtime.rs); the host keys trust grants and channels on it,
 * so this is a KNOWN projection sitting beside the fs flatten, not a third string.
 * @param {string} id
 * @returns {string}
 */
export function pluginIdRuntimeToken(id) {
	const seg = id.trim().split("/").pop();
	return seg && seg.trim() ? seg : id;
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
	const token = pluginId.replace(/[/\\]/g, "_").replace(/@/g, "").replace(NON_FS_SAFE_RE, "_");
	return /^\.+$/.test(token) ? `_${token}` : token;
}

export function isAgentPluginId(pluginId) {
	return normalizePluginId(pluginId) === AGENT_PLUGIN_ID;
}

export function isRuntimeAgentPluginId(pluginId) {
	return normalizePluginId(pluginId) === RUNTIME_AGENT_PLUGIN_ID;
}

export function isRuntimeAgentErrorContent(content) {
	return RUNTIME_AGENT_ERROR_PREFIXES.some((prefix) => content.startsWith(prefix));
}

// Content already uses the canonical `[runtime-agent …]` labels; the legacy
// `[pi-agent …]` translation was dropped with the pi-agent generation (fresh
// store, no pre-rename sessions to normalize). Kept as an identity passthrough so
// callers (sessions.ts) need no change, and as the seam if a future canonicaliser
// is needed.
export function canonicalRuntimeAgentContent(content) {
	return content;
}
