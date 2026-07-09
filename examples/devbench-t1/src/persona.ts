import {
	createLocalCapabilityDeps,
	definePluginInspectorCapability,
	type CapabilityDeps,
	type CapabilityDescriptor,
	type PluginDescriptorDeps,
	type SurfaceableManifest,
} from "@refarm.dev/capability-host";

/**
 * The T1 persona (PROCESS mode). devbench shows the developer's angle: the ACT of
 * declaring an extension and watching it multi-surface. Unlike T2/T3 (which present a
 * finished product), T1 exposes the MACHINE — a coding-agent plugin manifest surfaces
 * its verbs via the bridge, and an inspector verb makes the extension mechanism
 * visible. The focus is technical and general: "declare once → it appears everywhere".
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

export function devCapabilityDeps(): CapabilityDeps {
	return createLocalCapabilityDeps();
}

/** The T1 inspector verb: `extension` - makes the extension MECHANISM visible. It
 * shows what the coding-agent manifest declared and which capability verbs the bridge
 * synthesized from it (the machine, exposed — the developer's view of "declare once").
 */
export function createExtensionCapability(
	manifest: SurfaceableManifest,
	pluginDeps: PluginDescriptorDeps,
	peers: readonly SurfaceableManifest[] = [],
): CapabilityDescriptor {
	return definePluginInspectorCapability({
		name: "extension",
		summary: "Inspect the coding-agent extension: what it declares, how it surfaces",
		manifest,
		deps: pluginDeps,
		httpPath: "/ext/inspect",
		// The other loaded extensions, so the inspector can resolve this plugin's
		// requiresApi against their providesApi — surfacing the recursion (the
		// coding-agent consuming the notes-indexer's NotesLookup API).
		peers,
		renderers: {
			tui: { section: "extension" },
			web: { route: "/extension", icon: "extension" },
		},
		note:
			"Each surfaced verb is a first-class command on CLI/REPL/TUI/HTTP/agent — declared once, no per-surface wiring.",
	});
}
