import { walletApp } from "../cli.js";
import { mountConsentJourney } from "./consent-journey.js";

/**
 * The CONSENT web face (T2-F7) — the decision moment as a real, LIVE screen. It mounts the
 * consent journey (pending prompts with Authorize/Decline + granted authorizations with Revoke,
 * all wired to the wallet's verbs) and adds a demo control so a first-time visitor can SEE a
 * service's request without touching the CLI: click "simulate a request", the prompt appears,
 * decide, and watch it move into "my authorizations". The prompt render is the substrate's
 * (@refarm.dev/authorization-contract-v1); the wiring is a shared loop (consent-journey.ts).
 */

/** Fictitious services a visitor can simulate — each asks for the minimum scope for a stated
 * purpose, so the demo shows purpose-bound, minimal requests (never open-ended). */
const DEMO_REQUESTS = [
	{ requester: "Loja Fictícia", purpose: "Confirmar maioridade para a compra", scope: "faixa_etaria" },
	{ requester: "Portal do Cidadão", purpose: "Validar vínculo e município para o benefício", scope: "vinculo,municipio" },
	{ requester: "Banco Fictício", purpose: "Verificar município para abrir conta", scope: "municipio" },
];

export async function bootConsent(): Promise<void> {
	const overlay = document.getElementById("loading-overlay");
	const mount = document.getElementById("consent-mount");
	try {
		if (!mount) throw new Error("no #consent-mount");
		const registry = walletApp.registry();
		const journey = await mountConsentJourney(registry, mount, {
			caption: document.getElementById("consent-caption"),
		});
		mountDemoSeed(registry, mount, journey.refresh);
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

/** A "simulate a request" button that submits a fictitious service request through the real
 * `request` verb, then refreshes — the demo entry point into the T2-F7 decision. */
function mountDemoSeed(
	registry: ReturnType<typeof walletApp.registry>,
	mount: HTMLElement,
	refresh: () => Promise<void>,
): void {
	let next = 0;
	const button = document.createElement("button");
	button.type = "button";
	button.className = "refarm-btn refarm-consent-seed";
	button.textContent = "Simular um pedido de serviço";
	button.addEventListener("click", () => {
		void (async () => {
			const demo = DEMO_REQUESTS[next++ % DEMO_REQUESTS.length]!;
			const request = registry.get("request");
			if (!request || !("run" in request)) return;
			button.setAttribute("disabled", "true");
			try {
				const expires = new Date(Date.now() + 30 * 86_400_000).toISOString();
				await request.run({
					args: { requester: demo.requester },
					options: { purpose: demo.purpose, scope: demo.scope, expires },
					json: true,
				});
				await refresh();
			} finally {
				button.removeAttribute("disabled");
			}
		})();
	});
	mount.parentElement?.insertBefore(button, mount);
}
