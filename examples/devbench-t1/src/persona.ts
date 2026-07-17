import {
	createLocalCapabilityDeps,
	definePluginInspectorCapability,
	type CapabilityDeps,
	type CapabilityDescriptor,
	type PluginDescriptorDeps,
	type SurfaceableManifest,
} from "@refarm.dev/capability-host";
import { createCapabilityWebSurfacePlugin } from "@refarm.dev/capability-homestead-surface";

import { resolveDevbenchTheme } from "./theme.js";

/** The registry type the bridge accepts — inferred from the bridge so the example doesn't
 * import the cli/capabilities type directly (it reaches the bridge, not cli). */
type BridgeRegistry = Parameters<typeof createCapabilityWebSurfacePlugin>[0];

/**
 * The T1 persona (PROCESS mode). devbench shows the developer's angle: the ACT of
 * declaring an extension and watching it multi-surface. Unlike T2/T3 (which present a
 * finished product), T1 exposes the MACHINE — a coding-agent plugin manifest surfaces
 * its verbs via the bridge, and an inspector verb makes the extension mechanism
 * visible. The focus is technical and general: "declare once → it appears everywhere".
 */

// The plugin manifests + SPI API names are PURE DATA, extracted to ./manifests.ts so the WEB face
// (extension-graph) can import them without pulling this file's node-bound deps into the browser
// bundle. Re-exported here so every CLI-side import path (cli.ts, plugin-ops, report) is unchanged.
export {
	NOTES_LOOKUP_API,
	CODING_AGENT_MANIFEST,
	NOTES_INDEXER_MANIFEST,
	DEVBENCH_DEFAULT_MANIFESTS,
	AGENT_RESPOND_API,
	AGENT_MANIFEST,
	DELEGATE_MANIFEST,
	DEVBENCH_LIVE_MANIFESTS,
	DEVBENCH_LIVE_PLUGIN_IDS,
} from "./manifests.js";

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
			// T1 forces the open surface axis (ADR-085): `palette` is a surface added
			// AFTER this verb was written, yet the inspector lights up in the quick-switcher
			// from this one added hint — no edit to the verb's run(), no per-surface wiring.
			// This IS the "declare once → new surface for free" the inspector demonstrates.
			palette: { group: "extension", keybind: "g x", hint: "inspect the extension mechanism" },
		},
		note: "Each surfaced verb is a first-class command on CLI/REPL/TUI/HTTP/agent/palette — declared once, no per-surface wiring.",
	});
}

/**
 * The T1 web face — the SAME registry, projected into a Homestead surface plugin by the
 * bridge. T1 is PROCESS mode: it proves "declare `renderers.web` once → a real web panel
 * for free". ABOVE the launcher cards it renders the plugin dependency GRAPH (the SPI
 * recursion the writeup describes) via the generic content seam — the "shows well"
 * artifact, mounted, not just returned as a string. A host registers the returned handle;
 * the headless `handle.call("renderHomesteadSurface", …)` render is the proof.
 */
export function devWebSurface(registry: BridgeRegistry) {
	// The web header carries the theme's tagline (DGK_THEME: neutral | serpro) — the same
	// overlay that themes the CLI, so the web face is framed for its context too.
	const theme = resolveDevbenchTheme();
	return createCapabilityWebSurfacePlugin(registry, {
		pluginId: "@devbench/extension-web",
		name: "Extension Bench",
		title: theme.tagline,
		// The content seam: the boot runs a content verb and puts its result on host.data;
		// render ABOVE the cards whatever governance content it carried — the governance
		// DASHBOARD (scorecard + outcomes + metrics) and/or the SPI dependency GRAPH. Both
		// are the "shows well" artifacts the writeup photographs.
		content: (data) => {
			const dashboard = typeof data.governanceHtml === "string" ? data.governanceHtml : "";
			const graph =
				typeof data.graphSvg === "string" && data.graphSvg.length > 0
					? `<section class="refarm-stack" data-extension-graph>${data.graphSvg}</section>`
					: "";
			// The unified plugin-operations dashboard, when the content verb carried it.
			const ops = typeof data.pluginOpsHtml === "string" ? data.pluginOpsHtml : "";
			return dashboard + ops + graph;
		},
	});
}
