import { interactiveStyles, mountGraph, type GraphInput } from "@refarm.dev/surveyor";

import { reqbenchApp } from "../cli.js";

/**
 * The requirement-network WEB face — the interactive graph. It runs the SAME `requirements-graph`
 * verb the CLI exposes, takes its `{graph, labels}` projection, and mounts the substrate's
 * interactive Surveyor (pan/zoom/drag/hover, click → focus a node). The example writes no graph
 * code: the layout, render, and interaction are all `@refarm.dev/surveyor`; this only runs the
 * verb and wires the result to a mount element.
 */
export async function bootRequirementsGraph(): Promise<void> {
	const overlay = document.getElementById("loading-overlay");
	const mount = document.getElementById("graph-mount");
	try {
		const registry = reqbenchApp.registry();
		const entry = registry.get("requirements-graph");
		if (!entry || !("run" in entry) || typeof entry.run !== "function") {
			throw new Error("requirements-graph verb not found in the registry");
		}
		const result = (await entry.run({ args: {}, options: {}, json: true })) as unknown as {
			graph?: GraphInput;
			labels?: Record<string, string>;
			total?: number;
		};
		if (!mount) throw new Error("no #graph-mount element");
		if (!result.graph || result.graph.nodes.length === 0) {
			mount.innerHTML = `<p class="refarm-muted">Nenhum requisito ainda — faça um <code>pull</code> ou <code>crawl</code> primeiro.</p>`;
			overlay?.remove();
			return;
		}

		// The interactive graph's companion CSS, injected once (self-contained; no external sheet).
		const style = document.createElement("style");
		style.textContent = interactiveStyles();
		document.head.appendChild(style);

		const labels = result.labels ?? {};
		mountGraph(mount, result.graph, {
			labelFor: (id) => labels[id] ?? id,
			onNodeClick: (id) => {
				// Focus the clicked requirement: reflect it in the URL hash (a host can deep-link).
				location.hash = id;
			},
		});
		const caption = document.getElementById("graph-caption");
		if (caption) caption.textContent = `${result.total ?? result.graph.nodes.length} requisitos · arraste, dê zoom, clique para focar`;
		overlay?.remove();
	} catch (error) {
		console.error("[reqbench-t3] graph boot failed", error);
		if (overlay) {
			overlay.textContent = `Falha ao abrir o grafo: ${error instanceof Error ? error.message : String(error)}`;
		}
	}
}
