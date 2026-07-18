import { mountCapabilityWebView } from "@refarm.dev/capability-homestead-surface/boot";
import { interactiveStyles, mountGraph, type GraphInput } from "@refarm.dev/surveyor";

import { createGraphWebRegistry } from "./graph-app.js";

/** The `requirements-graph` verb's projection — the Surveyor graph + its node labels. */
type GraphResult = { graph?: GraphInput; labels?: Record<string, string>; total?: number };

/**
 * The requirement-network WEB face — the interactive graph. It runs the SAME `requirements-graph`
 * verb the CLI exposes, takes its `{graph, labels}` projection, and mounts the substrate's
 * interactive Surveyor (pan/zoom/drag/hover, click → focus a node). The example writes no graph
 * code AND no boot boilerplate: the layout/render/interaction are `@refarm.dev/surveyor`, and the
 * overlay lifecycle + empty state + error display are the framework's `mountCapabilityWebView` —
 * this only maps the verb result onto the mount. The registry is browser-safe (graph-app.ts), so
 * this boots in a real browser with no node/WASM in the bundle (it imports nothing from ../cli.js).
 */
export async function bootRequirementsGraph(): Promise<void> {
	await mountCapabilityWebView<GraphResult>({
		namespace: "reqbench-t3",
		registry: createGraphWebRegistry(),
		content: { verb: "requirements-graph" },
		errorLabel: "Falha ao abrir o grafo",
		view: {
			mount: "graph-mount",
			isEmpty: (r) => !r.graph || r.graph.nodes.length === 0,
			emptyHtml: `<p class="refarm-muted">Nenhum requisito ainda — faça um <code>pull</code> ou <code>crawl</code> primeiro.</p>`,
			render: ({ result, mount }) => {
				const graph = result.graph!; // isEmpty guards graph presence + non-empty nodes

				// The interactive graph's companion CSS, injected once (self-contained; no external sheet).
				const style = document.createElement("style");
				style.textContent = interactiveStyles();
				document.head.appendChild(style);

				const labels = result.labels ?? {};
				mountGraph(mount, graph, {
					labelFor: (id) => labels[id] ?? id,
					onNodeClick: (id) => {
						// Focus the clicked requirement: reflect it in the URL hash (a host can deep-link).
						location.hash = id;
					},
				});
				const caption = document.getElementById("graph-caption");
				if (caption) caption.textContent = `${result.total ?? graph.nodes.length} requisitos · arraste, dê zoom, clique para focar`;
			},
		},
	});
}
