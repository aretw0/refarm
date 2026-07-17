import type { SurfaceableManifest } from "@refarm.dev/capability-host";

/**
 * The devbench plugin manifests + SPI API names — PURE DATA, in their own module so the WEB face
 * (the extension-graph) can import them without dragging persona.ts (which pulls
 * createLocalCapabilityDeps + the capability-host node barrel at module load) into the browser
 * bundle. persona.ts re-exports every symbol here, so the CLI import paths are unchanged. Only the
 * `SurfaceableManifest` TYPE is imported, and it is erased — nothing here reaches node.
 */

/** The API the notes-indexer offers to OTHER plugins (the SPI axis). A plugin that
 * declares `requiresApi: [NOTES_LOOKUP_API]` resolves this provider via the host's
 * `get-plugin-api` and calls it via `call-plugin` — one extension using another. */
export const NOTES_LOOKUP_API = "NotesLookup";

/** The extension under development — a coding-agent plugin. Its manifest declares
 * dispatchable verbs; the bridge surfaces each onto every surface with a host-built
 * dispatch run() the developer never writes. This is the same shape a real installed
 * plugin.json carries.
 *
 * It also `requiresApi: [NOTES_LOOKUP_API]` — the coding-agent is ITSELF a plugin, and
 * it consumes another plugin (the notes-indexer) through the host. This is the T1 point:
 * extensions extend extensions, host-mediated, no import and no privilege. */
export const CODING_AGENT_MANIFEST: SurfaceableManifest = {
	id: "@devbench/coding-agent",
	capabilities: {
		provides: ["agent:code", "agent:review"],
		subscribes: ["agent:dispatch"],
		requiresApi: [NOTES_LOOKUP_API],
	},
};

/** A second extension to prove multiple manifests can coexist in one host and still be
 * surfaced by the same register-at-load seam.
 *
 * It intentionally targets a different plugin namespace (`notes`) so people can see how
 * `vault:search` and `web:search` would remain distinct when a power user installs
 * multiple plugins with overlapping verbs.
 *
 * It `providesApi: [NOTES_LOOKUP_API]`, so the coding-agent above can consume it — the
 * provider half of the plugin-to-plugin recursion. */
export const NOTES_INDEXER_MANIFEST: SurfaceableManifest = {
	id: "@devbench/notes-indexer",
	capabilities: {
		provides: ["notes:search", "notes:index"],
		subscribes: ["notes:dispatch"],
		providesApi: [NOTES_LOOKUP_API],
	},
};

export const DEVBENCH_DEFAULT_MANIFESTS: readonly SurfaceableManifest[] = [
	CODING_AGENT_MANIFEST,
	NOTES_INDEXER_MANIFEST,
];

/** The API the agent offers to other plugins — a plugin that `requiresApi: [AGENT_RESPOND_API]`
 * resolves the agent via `get-plugin-api` and drives it via `call-plugin`. This is a REAL,
 * built, executed SPI edge (unlike the illustrative coding-agent → notes-indexer above): the
 * delegate plugin does exactly this, proven live by `delegate-run --chain`. */
export const AGENT_RESPOND_API = "AgentRespond";

/** The REAL agent plugin (its dist manifest declares `providesApi: ["AgentRespond"]`). */
export const AGENT_MANIFEST: SurfaceableManifest = {
	id: "@refarm/agent",
	capabilities: { providesApi: [AGENT_RESPOND_API] },
};

/** The REAL delegate plugin — it CONSUMES the agent's AgentRespond via host-mediated
 * `call_plugin` (packages/delegate/src/lib.rs), so its manifest declares `requiresApi:
 * ["AgentRespond"]`. This is the SPI edge that actually EXECUTES (delegate-run --chain). */
export const DELEGATE_MANIFEST: SurfaceableManifest = {
	id: "@refarm/delegate",
	capabilities: { requiresApi: [AGENT_RESPOND_API] },
};

/** The REAL plugins whose SPI edge is not drawn-but-fictional but drawn-AND-executed: the
 * delegate → agent edge, live via `delegate-run --chain`. `extension-graph` marks this edge
 * `executed: true` to distinguish it from the illustrative coding-agent → notes-indexer one. */
export const DEVBENCH_LIVE_MANIFESTS: readonly SurfaceableManifest[] = [AGENT_MANIFEST, DELEGATE_MANIFEST];

/** The ids of plugins backed by a real, built .wasm — the SPI edge between two of these is
 * one the runtime actually executes (not just declares). */
export const DEVBENCH_LIVE_PLUGIN_IDS: readonly string[] = [AGENT_MANIFEST.id, DELEGATE_MANIFEST.id];
