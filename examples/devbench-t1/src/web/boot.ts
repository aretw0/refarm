import { bootCapabilityWebFace } from "@refarm.dev/capability-homestead-surface/boot";

import { devbenchApp } from "../cli.js";
import { devWebSurface } from "../persona.js";

/**
 * The devbench WEB face — T1 PROCESS mode. The bridge projects the manifest-declared verbs
 * into launcher cards; ABOVE them, the content seam runs `extension-graph` and mounts its
 * SVG — the plugin dependency graph (the SPI recursion) SEEN, not just returned as a string.
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
			// Run extension-graph and feed its SVG to the surface's content projector.
			content: { verb: "extension-graph", field: "graphSvg" },
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
