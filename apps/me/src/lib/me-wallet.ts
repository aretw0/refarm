import { createCapabilityRegistry } from "@refarm.dev/capabilities";
import { defaultRecordsDeps } from "@refarm.dev/capabilities-v1/records-view";
import { createCapabilityWebSurfacePlugin } from "@refarm.dev/capability-homestead-surface";
import type { RuntimePluginHandle } from "@refarm.dev/runtime";
import {
	createInMemoryAuthorizationProviderFixture,
	createWalletAuthorizeCapability,
	createWalletConsentCapability,
	createWalletDeclineCapability,
	createWalletPresentCapability,
	createWalletRequestCapability,
	createWalletRevokeCapability,
} from "@refarm.dev/wallet/browser";

export const REFARM_ME_WALLET_SURFACE_PLUGIN_ID = "refarm-me-wallet-surface";

/**
 * The citizen's WALLET as ONE surface of the hub — the consent journey, live in the
 * browser: a service REQUESTS attributes, the citizen SEES the pending consent and
 * decides (consent/decline), authorizes a purpose-bound scope, PRESENTS only that
 * scope, and can revoke it later.
 *
 * Composed STRICTLY from `@refarm.dev/wallet/browser` — the wallet's isomorphic core.
 * The main barrel's assembly (walletCapabilityBundle, credentials/verifier providers)
 * imports `capability-host/node` + `node:fs` and CANNOT exist in a browser bundle;
 * slice 3 originally mounted that barrel and the hub only booted in jsdom (where
 * node modules exist) — the first real-browser drive of the built hub caught it.
 * In-memory records + authorization fixture out of the box; durable OPFS backing and
 * the WASM signer stay follow-ons.
 */
export function createRefarmMeWalletSurface(
	options: { slot?: string } = {},
): RuntimePluginHandle {
	const records = defaultRecordsDeps();
	const { provider } = createInMemoryAuthorizationProviderFixture();
	const registry = createCapabilityRegistry([
		createWalletRequestCapability(records),
		createWalletConsentCapability(records),
		createWalletDeclineCapability(records),
		createWalletAuthorizeCapability(records, provider),
		createWalletPresentCapability(records, provider),
		createWalletRevokeCapability(records, provider),
	]);
	return createCapabilityWebSurfacePlugin(registry, {
		pluginId: REFARM_ME_WALLET_SURFACE_PLUGIN_ID,
		name: "Refarm.me Wallet",
		title: "👜 Minha Carteira Digital",
		...(options.slot ? { slot: options.slot } : {}),
	}) as RuntimePluginHandle;
}
