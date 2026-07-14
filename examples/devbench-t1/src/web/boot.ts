import { bootCapabilityWebFace } from "@refarm.dev/capability-homestead-surface/boot";

import { devbenchApp } from "../cli.js";
import { devWebSurface } from "../persona.js";

/**
 * The devbench WEB face — T1 PROCESS mode. The bridge projects the manifest-declared verbs
 * into launcher cards; ABOVE them, the content seam runs `governance-poc` and mounts its
 * DASHBOARD (the weighted scorecard, per-combination outcomes, metrics) — the governance
 * "shows well" artifact the writeup photographs. The SPI dependency graph is one card away
 * (its own route), so the dashboard leads and the graph is a click.
 */
export async function bootDevbench(): Promise<void> {
	const overlay = document.getElementById("loading-overlay");
	try {
		const registry = devbenchApp.registry();
		await bootCapabilityWebFace({
			databaseName: "devbench-web",
			namespace: "devbench",
			registry,
			surfaceContext: devbenchApp.surfaceContext(),
			surface: devWebSurface(registry),
			// Run governance-poc (no field) so its result — including governanceHtml — reaches
			// the surface's content projector, which renders the dashboard above the cards.
			content: { verb: "governance-poc" },
		});
		overlay?.remove();
	} catch (error) {
		console.error("[devbench-t1] web boot failed", error);
		if (overlay) {
			overlay.textContent = `Falha ao abrir a bancada de extensões: ${
				error instanceof Error ? error.message : String(error)
			}`;
		}
	}
}
