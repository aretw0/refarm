import { bootCapabilityWebShell } from "@refarm.dev/homestead/sdk";

import { walletApp } from "../cli.js";
import { walletWebSurface } from "../persona.js";

/**
 * The wallet's WEB face — proof that a capability app gets a real Astro/Homestead page
 * from the SAME declaration that drives its CLI, with no bespoke runtime module. The whole
 * boot is: build the registry, run the `wallet` verb to get the citizen's items, mount the
 * surface with that content, and let the shared shell render it into the page's slot.
 */
async function runWalletVerb(): Promise<Record<string, unknown>> {
	const registry = walletApp.registry();
	const wallet = registry.get("wallet");
	if (!wallet || "actions" in wallet) return {};
	// The verb's projected result carries `walletHtml` (see persona.ts) — the content the
	// surface renders above the launcher cards.
	return (await wallet.run({ args: {}, options: {}, json: true })) as unknown as Record<
		string,
		unknown
	>;
}

export async function bootWallet(): Promise<void> {
	const overlay = document.getElementById("loading-overlay");
	try {
		const registry = walletApp.registry();
		const verbResult = await runWalletVerb();

		await bootCapabilityWebShell({
			databaseName: "wallet-web",
			namespace: "wallet",
			surfaces: [walletWebSurface(registry)],
			surfaceContext: walletApp.surfaceContext(),
			// The verb's rendered wallet HTML → the surface's content seam (host.data.walletHtml),
			// so the citizen sees the actual wallet. The helper merges it into host.data.
			hostData: { walletHtml: verbResult.walletHtml ?? "" },
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
