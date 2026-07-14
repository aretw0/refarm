import { bootCapabilityWebFace } from "@refarm.dev/capability-homestead-surface/boot";

import { walletApp } from "../cli.js";
import { walletWebSurface } from "../persona.js";

/**
 * The wallet's WEB face — a capability app gets a real Astro/Homestead page from the SAME
 * declaration that drives its CLI. `bootCapabilityWebFace` runs the `wallet` verb, mounts
 * the wallet surface (reused from persona, with its content seam), and renders the citizen's
 * items into the page's slot. No bespoke runtime, no hand-run verb — the boot is one call.
 */
export async function bootWallet(): Promise<void> {
	const overlay = document.getElementById("loading-overlay");
	try {
		const registry = walletApp.registry();
		await bootCapabilityWebFace({
			databaseName: "wallet-web",
			namespace: "wallet",
			registry,
			surfaceContext: walletApp.surfaceContext(),
			// The content seam runs the SOVEREIGNTY dashboard (credentials + consent + disclosure +
			// timeline) as the headline above the verb cards — the citizen's whole posture in one
			// photograph. The wallet item list stays reachable via its own card.
			content: { verb: "sovereignty" },
			surface: walletWebSurface(registry),
		});
		overlay?.remove();
	} catch (error) {
		console.error("[wallet-t2] web boot failed", error);
		if (overlay) {
			overlay.textContent = `Falha ao abrir a carteira: ${
				error instanceof Error ? error.message : String(error)
			}`;
		}
	}
}
