import { bootCapabilityWebFace } from "@refarm.dev/capability-homestead-surface/boot";

import { devbenchApp } from "../cli.js";
import { devWebSurface } from "../persona.js";

/**
 * The devbench WEB face — T1 PROCESS mode. Unlike T2/T3, the web face shows the extension
 * MECHANISM: the bridge projects the manifest-declared verbs into launcher cards. No content
 * seam (the cards ARE the point) — so bootCapabilityWebFace just mounts the surface.
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
