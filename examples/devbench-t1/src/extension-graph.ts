// The envelope builder comes from the browser-safe origin (@refarm.dev/capabilities/envelope), not
// the @refarm.dev/capability-host barrel, so the WEB face can import this factory without pulling
// node into the bundle. buildExtensionGraph + graphToSvg are pure; the types are erased.
import { buildJsonSuccessEnvelope } from "@refarm.dev/capabilities/envelope";
import type {
	CapabilityDescriptor,
	CapabilityEnvelope,
	CapabilityInput,
	SurfaceableManifest,
} from "@refarm.dev/capability-host";
import { graphToSvg, type GraphInput } from "@refarm.dev/surveyor";

/**
 * EXTENSION GRAPH — draw the plugin dependency graph the T1 writeup describes in prose.
 * The manifests already declare it: each plugin is a NODE; a plugin's `requiresApi: [X]`
 * resolves to whichever plugin declares `providesApi: [X]`, and THAT is the SPI edge —
 * the coding-agent → notes-indexer recursion, host-mediated, made visible. `graphToSvg`
 * (Surveyor, generic over `{nodes, links}`) renders it to an SVG a doc/screenshot/web
 * page shows. Same block the T3 requirements graph uses; here the records are plugins.
 */

/** A short display label for a plugin id (`@devbench/coding-agent` → `coding-agent`). */
export function pluginShortName(id: string): string {
	return id.split("/").pop() ?? id;
}

export interface ExtensionGraph {
	graph: GraphInput;
	labels: Record<string, string>;
	/** The SPI edges. `executed: true` means BOTH endpoints are real, built plugins and the
	 * runtime actually drives this edge (e.g. delegate → agent, live via delegate-run --chain);
	 * `false` is an illustrative edge declared by synthetic manifests (drawn, not executed). */
	apiEdges: Array<{ from: string; to: string; api: string; executed: boolean }>;
}

export interface BuildExtensionGraphOptions {
	/** Ids of plugins backed by a real, built .wasm. An SPI edge whose BOTH endpoints are in
	 * this set is marked `executed` — the runtime drives it, it isn't merely drawn. */
	livePluginIds?: readonly string[];
}

/**
 * Build the plugin dependency graph from the manifests. Nodes = plugin ids; links = the
 * SPI edges (a plugin's `requiresApi` → the plugin that `providesApi` it). A plugin's
 * `provides`/`subscribes` count toward its degree so a well-connected plugin renders
 * larger. An edge between two `livePluginIds` is flagged `executed` (drawn AND run) vs a
 * synthetic edge (drawn only). Pure — unit-tested.
 */
export function buildExtensionGraph(
	manifests: readonly SurfaceableManifest[],
	options: BuildExtensionGraphOptions = {},
): ExtensionGraph {
	const live = new Set(options.livePluginIds ?? []);
	const labels: Record<string, string> = {};
	// Map each provided API name → the plugin id that provides it, so a requiresApi can
	// resolve to its provider (the SPI edge target).
	const providerOf = new Map<string, string>();
	for (const m of manifests) {
		labels[m.id] = pluginShortName(m.id);
		for (const api of m.capabilities?.providesApi ?? []) {
			providerOf.set(api, m.id);
		}
	}

	const apiEdges: Array<{ from: string; to: string; api: string; executed: boolean }> = [];
	const links: Array<{ source: string; target: string }> = [];
	const degree = new Map<string, number>();
	const bump = (id: string, n = 1) => degree.set(id, (degree.get(id) ?? 0) + n);

	for (const m of manifests) {
		const caps = m.capabilities ?? {};
		// Provided verbs + subscriptions make a plugin more central.
		bump(m.id, (caps.provides?.length ?? 0) + (caps.subscribes?.length ?? 0));
		// The SPI edge: this plugin requires an API that another plugin provides.
		for (const api of caps.requiresApi ?? []) {
			const provider = providerOf.get(api);
			if (provider && provider !== m.id) {
				links.push({ source: m.id, target: provider });
				// Executed iff both endpoints are real, built plugins the runtime drives.
				apiEdges.push({ from: m.id, to: provider, api, executed: live.has(m.id) && live.has(provider) });
				bump(m.id);
				bump(provider);
			}
		}
	}

	const nodes = manifests.map((m) => ({ id: m.id, degree: degree.get(m.id) ?? 0 }));
	return { graph: { nodes, links }, labels, apiEdges };
}

/**
 * `extension-graph [--svg]` — render the plugin dependency graph. Default (JSON) reports
 * the nodes + SPI edges (the recursion, as data); `--svg` returns the rendered SVG the
 * web face / a screenshot shows. The graph the writeup's SPI-axis figure draws.
 */
export function createExtensionGraphCapability(
	manifests: readonly SurfaceableManifest[],
	options: BuildExtensionGraphOptions = {},
): CapabilityDescriptor {
	return {
		name: "extension-graph",
		summary: "Draw the plugin dependency graph — the SPI edges (requiresApi → providesApi), as SVG",
		options: [{ name: "svg", kind: "boolean", summary: "Return the rendered SVG instead of the JSON graph" }],
		transports: { http: { path: "/extension/graph" } },
		renderers: {
			tui: { section: "extension" },
			web: { route: "/extension-graph", icon: "share", resultField: "graphSvg" },
			ide: { command: "dgk.extension-graph" },
		},
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const { graph, labels, apiEdges } = buildExtensionGraph(manifests, options);
			const svg = graphToSvg(graph, {
				labelFor: (id) => labels[id] ?? id,
				title: "Plugin dependency graph — SPI edges (requiresApi → providesApi)",
			});
			const executedEdges = apiEdges.filter((e) => e.executed);
			return buildJsonSuccessEnvelope({
				command: "extension-graph",
				operation: "extension-graph",
				nextCommand: "dgk extension",
				nextCommands: ["dgk extension"],
				extra: {
					pluginCount: graph.nodes.length,
					// The recursion as data: which plugin consumes which via the SPI, and whether the
					// runtime actually EXECUTES that edge (delegate → agent) vs merely declares it.
					spiEdges: apiEdges,
					executedEdges,
					executedCount: executedEdges.length,
					// `svg` is the CLI-explicit copy (only under --svg, to keep JSON output lean).
					...(input.options?.svg === true ? { svg } : {}),
					// `graphSvg` is the content-seam field the web boot reads to mount the graph
					// (extension-graph-boot: content { verb: "extension-graph", field: "graphSvg" }).
					graphSvg: svg,
				},
			});
		},
	};
}
