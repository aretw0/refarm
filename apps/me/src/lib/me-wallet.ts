import { defineCapabilityHost } from "@refarm.dev/capability-host";
import type { RuntimePluginHandle } from "@refarm.dev/runtime";
import { createWalletCapabilities, walletCapabilityBundle, walletWebSurface } from "@refarm.dev/wallet";

export const REFARM_ME_WALLET_SURFACE_PLUGIN_ID = "refarm-me-wallet-surface";

/**
 * The citizen's WALLET as ONE surface of the hub — import/verify/hold credentials, purpose-bound
 * consent with selective disclosure of the citizen's VERIFIED attributes, and a sandboxed signer.
 *
 * Composed from the reusable `@refarm.dev/wallet` block (the SAME block the standalone example
 * proves) — so the hub consumes the framework directly and depends on no example. It is one panel
 * AMONG the hub's several (the personal surface, chat, and future panels), never the hub itself.
 * With the shared surface's dispatch loop + arg-input forms, the mounted wallet is immediately
 * usable in the browser, not a snapshot. Out of the box it uses the block's in-memory backing
 * (offline, deterministic); a durable OPFS-backed store is a follow-on.
 */
export function createRefarmMeWalletSurface(
	options: { statePath?: string; slot?: string } = {},
): RuntimePluginHandle {
	const { deps, records, credentialsProvider, identity, authorizationProvider, verifyPolicy } =
		walletCapabilityBundle(options.statePath ? { statePath: options.statePath } : {});
	const host = defineCapabilityHost({
		id: "apps/me/wallet",
		command: "wallet",
		description: "Carteira do cidadão",
		version: "0.0.0",
		capabilities: () => ({
			deps,
			extensions: createWalletCapabilities(records, {
				credentialsProvider,
				identity,
				authorizationProvider,
				...(verifyPolicy ? { verifyPolicy } : {}),
			}),
		}),
	});
	return walletWebSurface(host.registry(), {
		pluginId: REFARM_ME_WALLET_SURFACE_PLUGIN_ID,
		...(options.slot ? { slot: options.slot } : {}),
	}) as RuntimePluginHandle;
}
