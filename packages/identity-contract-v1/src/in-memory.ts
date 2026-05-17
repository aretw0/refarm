import type { Identity, IdentityProvider, SignatureResult, VerificationResult } from "./types.js";
import { IDENTITY_CAPABILITY } from "./types.js";

export function createInMemoryIdentityProvider(): IdentityProvider {
  const identities = new Map<string, Identity>();
  const signatures = new Map<string, { identityId: string; data: string }>();
  let idCounter = 0;

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
      const signature = `sig-${Date.now()}-${identityId}`;
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
  };
}
