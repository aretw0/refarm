import { bootCapabilityWebShell } from "@refarm.dev/homestead/sdk";

import { devbenchApp } from "../cli.js";
import { devWebSurface } from "../persona.js";

/**
 * The devbench WEB face — T1 PROCESS mode. Unlike T2/T3 (which show a product), the web
 * face here shows the extension MECHANISM: the bridge projects the manifest-declared verbs
 * into launcher cards, so "declare `renderers.web` once → a real web panel" is visible.
 * No content seam — the cards ARE the point. The whole boot is bootCapabilityWebShell over
 * the same registry that drives the CLI.
 *
 * (Drafted by the refarm agent itself — dogfooding the agent as a helper.)
 */
export async function bootDevbench(): Promise<void> {
	const overlay = document.getElementById("loading-overlay");
	try {
		const registry = devbenchApp.registry();
		await bootCapabilityWebShell({
			databaseName: "devbench-web",
			namespace: "devbench",
			surfaces: [devWebSurface(registry)],
			surfaceContext: devbenchApp.surfaceContext(),
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
