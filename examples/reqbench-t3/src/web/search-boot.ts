import { mountCapabilityWebFace } from "@refarm.dev/capability-homestead-surface/boot";

import { createSearchWebRegistry } from "./search-app.js";

/**
 * The SEARCH web face — the T3 "declare once → web that QUERIES" proof. The SAME
 * `requirements-search` verb that answers `dgk requirements-search "nota fiscal"` on the CLI
 * lights a live Astro page: `mountCapabilityWebFace` projects the verb into a card with a query
 * input, and when the analyst runs it the dispatch loop paints the verb's OWN result (its
 * `resultsHtml`, declared via `renderers.web.resultField`) in place — B2. No dashboard content
 * verb: the query and its matches ARE the screen. The registry is browser-safe (search-app.ts),
 * so this boots in a real browser with no node/WASM in the bundle. The boot boilerplate (overlay
 * lifecycle + error display) is the framework's mountCapabilityWebFace, not hand-rolled here.
 */
export async function bootSearch(): Promise<void> {
	await mountCapabilityWebFace({
		databaseName: "reqbench-search-web",
		namespace: "reqbench",
		registry: createSearchWebRegistry(),
		surface: {
			pluginId: "@refarm.dev/reqbench-search",
			title: "Buscar requisitos",
		},
		errorLabel: "Falha ao abrir a busca",
	});
}
