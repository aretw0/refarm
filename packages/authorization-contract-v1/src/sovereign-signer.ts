import type { AuthorizationSigner } from "./reference.js";

/**
 * The minimal structural shape this adapter needs from an identity provider — a subset of
 * `@refarm.dev/identity-contract-v1`'s IdentityProvider (`sign(id, data)` / `verify(sig, data)`).
 * Kept structural so authorization:v1 stays dependency-free while still bridging to a sovereign
 * (sandboxed WASM) signer.
 */
export interface IdentitySignerLike {
	sign(identityId: string, data: string): Promise<{ signature: string; algorithm?: string }>;
	verify(signature: string, data: string): Promise<{ valid: boolean } | boolean>;
}

/**
 * Adapt a sovereign IDENTITY — e.g. a sandboxed WASM Ed25519 signer whose private key never leaves
 * the boundary — to the {@link AuthorizationSigner} the reference provider injects. The consent
 * journey (authorize → present → verify) is then signed by the citizen's sovereign key rather than
 * a forgeable in-memory digest: the difference between "signed in my wallet" as a slogan and as a
 * guarantee. `identityId` is the holder identity that signs; `algorithm` labels the suite stamped
 * on each proof.
 *
 * Verification here covers RECEIPTS the holder signs for itself (the whole authorization journey),
 * which the provider can resolve because the identity is known. It is NOT a resolver for arbitrary
 * third-party signatures — that needs a DID/verificationMethod resolver, out of scope for v1.
 */
export function createSovereignAuthorizationSigner(
	identity: IdentitySignerLike,
	identityId: string,
	algorithm: string,
): AuthorizationSigner {
	return {
		algorithm,
		sign: async (canonical) => (await identity.sign(identityId, canonical)).signature,
		verify: async (canonical, signature) => {
			const result = await identity.verify(signature, canonical);
			return typeof result === "boolean" ? result : result.valid === true;
		},
	};
}
