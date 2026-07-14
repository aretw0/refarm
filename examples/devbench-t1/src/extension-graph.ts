import {
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type CapabilityInput,
	type SurfaceableManifest,
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
	/** The SPI edges, as `{from, to, api}` — what the recursion IS, for the JSON envelope. */
	apiEdges: Array<{ from: string; to: string; api: string }>;
}

/**
 * Build the plugin dependency graph from the manifests. Nodes = plugin ids; links = the
 * SPI edges (a plugin's `requiresApi` → the plugin that `providesApi` it). A plugin's
 * `provides`/`subscribes` count toward its degree so a well-connected plugin renders
 * larger. Pure — unit-tested.
 */
export function buildExtensionGraph(manifests: readonly SurfaceableManifest[]): ExtensionGraph {
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

	const apiEdges: Array<{ from: string; to: string; api: string }> = [];
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
				apiEdges.push({ from: m.id, to: provider, api });
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
): CapabilityDescriptor {
	return {
		name: "extension-graph",
		summary: "Draw the plugin dependency graph — the SPI recursion (agent → notes-indexer), as SVG",
		options: [{ name: "svg", kind: "boolean", summary: "Return the rendered SVG instead of the JSON graph" }],
		transports: { http: { path: "/extension/graph" } },
		renderers: { tui: { section: "extension" }, web: { route: "/extension-graph", icon: "share" }, ide: { command: "dgk.extension-graph" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const { graph, labels, apiEdges } = buildExtensionGraph(manifests);
			const svg = graphToSvg(graph, {
				labelFor: (id) => labels[id] ?? id,
				title: "Plugin dependency graph — SPI edges (requiresApi → providesApi)",
			});
			return buildJsonSuccessEnvelope({
				command: "extension-graph",
				operation: "extension-graph",
				nextCommand: "dgk extension",
				nextCommands: ["dgk extension"],
				extra: {
					pluginCount: graph.nodes.length,
					// The recursion as data: which plugin consumes which via the SPI.
					spiEdges: apiEdges,
					...(input.options?.svg === true ? { svg } : { svgAvailable: true }),
					// The web face mounts this to show the graph interactively.
					graphSvg: svg,
				},
			});
		},
	};
}
