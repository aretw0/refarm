import { describe, expect, it } from "vitest";

import {
  IDENTITY_CAPABILITY,
  runIdentityV1Conformance,
  type Identity,
  type IdentityProvider,
  type SignatureResult,
  type VerificationResult,
} from "./index.js";

class InMemoryIdentityProvider implements IdentityProvider {
  readonly pluginId = "@refarm/identity-memory-test";
  readonly capability = IDENTITY_CAPABILITY;

  private readonly identities = new Map<string, Identity>();
  private readonly signatures = new Map<string, { identityId: string; data: string }>();
  private idCounter = 0;

  async create(displayName?: string): Promise<Identity> {
    const id = `identity-${++this.idCounter}`;
    const identity: Identity = {
      id,
      publicKey: `pubkey-${id}`,
      displayName,
      createdAt: new Date().toISOString(),
    };
    this.identities.set(id, identity);
    return identity;
  }

  async sign(identityId: string, data: string): Promise<SignatureResult> {
    const signature = `sig-${Date.now()}-${identityId}`;
    this.signatures.set(signature, { identityId, data });
    return {
      signature,
      algorithm: "test-hmac",
    };
  }

  async verify(signature: string, data: string): Promise<VerificationResult> {
    const stored = this.signatures.get(signature);
    const valid = stored !== undefined && stored.data === data;
    const identity = stored ? this.identities.get(stored.identityId) : undefined;

    if (!identity) {
      throw new Error("identity not found for signature");
    }

    return {
      valid,
      identity,
    };
  }

  async get(identityId: string): Promise<Identity | null> {
    return this.identities.get(identityId) ?? null;
  }
}

describe("identity:v1 conformance", () => {
  it("passes for a compatible provider", async () => {
    const provider = new InMemoryIdentityProvider();
    const result = await runIdentityV1Conformance(provider);

    expect(result.pass).toBe(true);
    expect(result.failed).toBe(0);
  });
});
