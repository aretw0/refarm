import { mountCapabilityWebFace } from "@refarm.dev/capability-homestead-surface/boot";

import { createExtensionGraphWebRegistry } from "./extension-graph-app.js";

/**
 * The EXTENSION-GRAPH web face — the T1 "extensions extend extensions" story as a picture. The
 * SAME `extension-graph` verb that draws the SPI graph on the CLI lights an Astro page: each plugin
 * is a node, a `requiresApi → providesApi` an edge, and the delegate → agent edge is marked
 * executed (the real host-mediated recursion, live via delegate-run --chain). The SVG renders on
 * load via the content seam, and re-running the verb from its card re-paints it via B2 (the verb
 * declares `renderers.web.resultField: "graphSvg"`). Browser-safe registry (extension-graph-app.ts)
 * + the framework's mountCapabilityWebFace — the whole boot is this one call.
 */
export async function bootExtensionGraph(): Promise<void> {
	await mountCapabilityWebFace({
		databaseName: "devbench-extension-graph-web",
		namespace: "devbench",
		registry: createExtensionGraphWebRegistry(),
		// Run extension-graph on load and mount its SVG as the headline.
		content: { verb: "extension-graph", field: "graphSvg" },
		surface: {
			pluginId: "@refarm.dev/devbench-extension-graph",
			title: "Grafo de extensões (SPI)",
			content: (data) => (typeof data.graphSvg === "string" ? data.graphSvg : ""),
		},
		errorLabel: "Falha ao abrir o grafo de extensões",
	});
}
