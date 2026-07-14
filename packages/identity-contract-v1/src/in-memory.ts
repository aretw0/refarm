import { createHash } from "node:crypto";

import type {
	Identity,
	IdentityProvider,
	SessionDerivationInput,
	SessionDerivedIdentityHandle,
	SignatureResult,
	VerificationResult,
} from "./types.js";
import { IDENTITY_CAPABILITY } from "./types.js";

export function createInMemoryIdentityProvider(): IdentityProvider {
	const identities = new Map<string, Identity>();
	const signatures = new Map<string, { identityId: string; data: string }>();
	let idCounter = 0;
	let signatureCounter = 0;

	return {
		pluginId: "@refarm.dev/identity-memory-test",
		capability: IDENTITY_CAPABILITY,

		async create(displayName?: string): Promise<Identity> {
			const id = `identity-${++idCounter}`;
			const identity: Identity = {
				id,
				publicKey: `pubkey-${id}`,
				displayName,
				createdAt: new Date().toISOString(),
			};
			identities.set(id, identity);
			return identity;
		},

		async sign(identityId: string, data: string): Promise<SignatureResult> {
			const signature = `sig-${++signatureCounter}-${identityId}`;
			signatures.set(signature, { identityId, data });
			return { signature, algorithm: "test-hmac" };
		},

		async verify(signature: string, data: string): Promise<VerificationResult> {
			const stored = signatures.get(signature);
			const valid = stored !== undefined && stored.data === data;
			const identity = stored ? identities.get(stored.identityId) : undefined;
			if (!identity) throw new Error("identity not found for signature");
			return { valid, identity };
		},

		async get(identityId: string): Promise<Identity | null> {
			return identities.get(identityId) ?? null;
		},

		/**
		 * Derive an identity DETERMINISTICALLY from a session key — the recovery/rotation
		 * primitive. The same session bytes always unlock the SAME identity (so a citizen who
		 * re-authenticates on a new device recovers exactly who they were), and the identity is
		 * (re)registered so sign/get/verify work afterward. This mirrors the WASM signer's model
		 * (hold the session, re-derive the key on demand) without leaving the process — the
		 * reference in-memory provider supports the contract hook so the recovery scenario is
		 * testable offline.
		 */
		async deriveFromSession(
			input: SessionDerivationInput,
		): Promise<SessionDerivedIdentityHandle> {
			const digest = createHash("sha256")
				.update(input.protocol)
				.update("\0")
				.update(Buffer.from(input.session))
				.digest("hex");
			const id = `identity-session-${digest.slice(0, 16)}`;
			const existing = identities.get(id);
			const identity: Identity = existing ?? {
				id,
				publicKey: `pubkey-${digest.slice(0, 32)}`,
				displayName: input.displayName,
				createdAt: new Date().toISOString(),
			};
			// Re-register on recovery (idempotent for the same session).
			identities.set(id, identity);
			return {
				handle: `session-handle:${digest.slice(0, 24)}`,
				identity,
				algorithm: "test-sha256-derive",
			};
		},
	};
}
