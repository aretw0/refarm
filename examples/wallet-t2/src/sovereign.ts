import {
	ReferenceCredentialsProvider,
	type CredentialsProvider,
} from "@refarm.dev/credentials-contract-v1";
import type { IdentityProvider } from "@refarm.dev/identity-contract-v1";
import { createReferenceWasmIdentityProvider } from "@refarm.dev/identity-provider-ref";
import { createInMemoryStorageProvider } from "@refarm.dev/storage-contract-v1";

/**
 * The sovereign wallet backing: the citizen's identity is a WASM component whose
 * Ed25519 private key is generated and held INSIDE the sandbox and never crosses
 * the boundary (@refarm.dev/identity-provider-ref). Every presentation the wallet
 * signs — `wallet share`, `wallet present` — is signed by that sandboxed key.
 *
 * This is the T2 thesis made real. Out of the box the wallet uses an in-memory
 * fixture (deterministic, offline, keys in JS) so import→verify→share works in a
 * test. `createSovereignWalletBundle()` swaps the citizen's identity for the
 * sovereign signer: the credentials provider still does the VC/VP plumbing, but
 * delegates every `sign` to the sandbox. The wallet holds no private key — the
 * difference between "my data, my wallet" as a slogan and as a guarantee.
 */
export interface SovereignWalletBundle {
	credentialsProvider: CredentialsProvider;
	identity: IdentityProvider;
}

/**
 * Build the credentials provider + identity pair backed by the sovereign WASM
 * signer. Async because instantiating the component is async (it is loaded under
 * the deny-all capability table by the provider-ref loader).
 */
export async function createSovereignWalletBundle(): Promise<SovereignWalletBundle> {
	// The citizen's identity: the sandboxed signer. The private key is born and
	// dies inside the component — this process never sees it.
	const identity = await createReferenceWasmIdentityProvider();
	// The VC/VP engine, wired to sign through that sovereign identity. Same
	// ReferenceCredentialsProvider the in-memory fixture uses; only the injected
	// identity changed — from keys-in-JS to keys-in-sandbox.
	const storage = createInMemoryStorageProvider();
	const credentialsProvider = new ReferenceCredentialsProvider({ identity, storage });
	return { credentialsProvider, identity };
}
