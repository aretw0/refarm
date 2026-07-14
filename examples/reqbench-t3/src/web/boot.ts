import { bootCapabilityWebFace } from "@refarm.dev/capability-homestead-surface/boot";

import { reqbenchApp } from "../cli.js";
import { reqWebSurface } from "../persona.js";

/**
 * The requirements bench WEB face — T3 as a real web product. The same `requirements`
 * declaration that drives the CLI lights an Astro/Homestead page: bootCapabilityWebFace runs
 * the verb for the navigable MOC and mounts the surface (reused from persona). One call.
 */
export async function bootReqbench(): Promise<void> {
	const overlay = document.getElementById("loading-overlay");
	try {
		const registry = reqbenchApp.registry();
		await bootCapabilityWebFace({
			databaseName: "reqbench-web",
			namespace: "reqbench",
			registry,
			surfaceContext: reqbenchApp.surfaceContext(),
			// The content seam runs the vault OVERVIEW (coverage + health + traceability + last
			// change) as the headline dashboard above the launcher cards — the whole vault state in
			// one photograph. The navigable MOC stays reachable via its own card/route.
			content: { verb: "requirements-overview" },
			surface: reqWebSurface(registry),
		});
		overlay?.remove();
	} catch (error) {
		console.error("[reqbench-t3] web boot failed", error);
		if (overlay) {
			overlay.textContent = `Falha ao abrir a bancada: ${
				error instanceof Error ? error.message : String(error)
			}`;
		}
	}
}
