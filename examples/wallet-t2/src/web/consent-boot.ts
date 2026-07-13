import { walletApp } from "../cli.js";

/**
 * The CONSENT web face (T2-F7) — the decision moment as a real screen. It runs the `consent`
 * verb, takes its `consentHtml` (the substrate's renderConsentPrompt for each pending request),
 * and mounts it. This is the citizen SEEING a service's request and deciding before anything is
 * shared. The example writes no consent UI; the prompt render is @refarm.dev/authorization-
 * contract-v1. Authorize/Decline controls carry the surface-action ids the host routes.
 */
export async function bootConsent(): Promise<void> {
	const overlay = document.getElementById("loading-overlay");
	const mount = document.getElementById("consent-mount");
	try {
		const registry = walletApp.registry();
		const verb = registry.get("consent");
		if (!verb || !("run" in verb) || typeof verb.run !== "function") {
			throw new Error("consent verb not found");
		}
		const result = (await verb.run({ args: {}, options: {}, json: true })) as unknown as {
			consentHtml?: string;
			pendingCount?: number;
		};
		if (!mount) throw new Error("no #consent-mount");
		mount.innerHTML = result.consentHtml ?? `<p class="refarm-muted">Nenhum pedido pendente.</p>`;
		const caption = document.getElementById("consent-caption");
		if (caption) {
			caption.textContent = result.pendingCount
				? `${result.pendingCount} pedido(s) aguardando sua decisão`
				: "Nenhum pedido pendente — você está em dia.";
		}
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
