import { bootCapabilityWebShell } from "@refarm.dev/homestead/sdk";

import { reqbenchApp } from "../cli.js";
import { reqWebSurface } from "../persona.js";

/**
 * The requirements bench WEB face — T3 as a real web product. The same `requirements`
 * declaration that drives the CLI lights an Astro/Homestead page: run the verb to get the
 * navigable MOC HTML, mount the surface with it, let the shared shell render it. No bespoke
 * runtime module — the whole boot is a few lines over bootCapabilityWebShell.
 */
async function runRequirementsVerb(): Promise<Record<string, unknown>> {
	const registry = reqbenchApp.registry();
	const requirements = registry.get("requirements");
	if (!requirements || "actions" in requirements) return {};
	// The projection carries `mocHtml` (see persona.ts) — the content the surface renders
	// above the launcher cards.
	return (await requirements.run({ args: {}, options: {}, json: true })) as unknown as Record<
		string,
		unknown
	>;
}

export async function bootReqbench(): Promise<void> {
	const overlay = document.getElementById("loading-overlay");
	try {
		const registry = reqbenchApp.registry();
		const verbResult = await runRequirementsVerb();
		const base = reqbenchApp.surfaceContext();

		await bootCapabilityWebShell({
			databaseName: "reqbench-web",
			namespace: "reqbench",
			surfaces: [reqWebSurface(registry)],
			surfaceContext: () => ({
				...base,
				data: { ...base.data, mocHtml: verbResult.mocHtml ?? "" },
			}),
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
