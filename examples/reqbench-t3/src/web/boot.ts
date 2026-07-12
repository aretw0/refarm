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
			content: { verb: "requirements", field: "mocHtml" },
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
