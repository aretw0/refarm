import { walletApp } from "../cli.js";
import { mountConsentJourney } from "./consent-journey.js";

/**
 * The CONSENT web face (T2-F7) — the decision moment as a real, LIVE screen. It mounts the
 * consent journey: each pending request renders as a prompt (the substrate's renderConsentPrompt),
 * and its Authorize / Decline controls are wired to the wallet's `authorize --request <id>` and
 * `decline <id>` verbs — click, and the decided request disappears. The example writes no consent
 * UI and no dispatch; the prompt is @refarm.dev/authorization-contract-v1, the wiring is a shared
 * loop (see consent-journey.ts).
 */
export async function bootConsent(): Promise<void> {
	const overlay = document.getElementById("loading-overlay");
	const mount = document.getElementById("consent-mount");
	try {
		if (!mount) throw new Error("no #consent-mount");
		await mountConsentJourney(walletApp.registry(), mount, {
			caption: document.getElementById("consent-caption"),
		});
		overlay?.remove();
	} catch (error) {
		console.error("[wallet-t2] consent boot failed", error);
		if (overlay) {
			overlay.textContent = `Falha ao abrir o consentimento: ${
				error instanceof Error ? error.message : String(error)
			}`;
		}
	}
}
