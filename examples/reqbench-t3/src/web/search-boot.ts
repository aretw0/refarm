import { bootCapabilityWebFace } from "@refarm.dev/capability-homestead-surface/boot";

import { createSearchWebRegistry } from "./search-app.js";

/**
 * The SEARCH web face — the T3 "declare once → web that QUERIES" proof. The SAME
 * `requirements-search` verb that answers `dgk requirements-search "nota fiscal"` on the CLI
 * lights a live Astro page: `bootCapabilityWebFace` projects the verb into a card with a query
 * input, and when the analyst runs it the dispatch loop paints the verb's OWN result (its
 * `resultsHtml`, declared via `renderers.web.resultField`) in place — B2. No dashboard content
 * verb: the query and its matches ARE the screen. The registry is browser-safe (search-app.ts),
 * so this boots in a real browser with no node/WASM in the bundle.
 */
export async function bootSearch(): Promise<void> {
	const overlay = document.getElementById("loading-overlay");
	try {
		const registry = createSearchWebRegistry();
		await bootCapabilityWebFace({
			databaseName: "reqbench-search-web",
			namespace: "reqbench",
			registry,
			surface: {
				pluginId: "@refarm.dev/reqbench-search",
				title: "Buscar requisitos",
			},
		});
		overlay?.remove();
	} catch (error) {
		console.error("[reqbench-t3] search boot failed", error);
		if (overlay) {
			overlay.textContent = `Falha ao abrir a busca: ${
				error instanceof Error ? error.message : String(error)
			}`;
		}
	}
}
