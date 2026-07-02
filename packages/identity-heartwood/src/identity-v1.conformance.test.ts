import { runIdentityV1Conformance } from "@refarm.dev/identity-contract-v1";
import { describe, expect, it } from "vitest";

import { HEARTWOOD_IDENTITY_ALGORITHM, createHeartwoodIdentityProvider } from "./index.js";

describe("@refarm.dev/identity-heartwood identity:v1 conformance", () => {
  it("passes identity:v1 with real Heartwood Ed25519 signatures", async () => {
    const provider = createHeartwoodIdentityProvider();
    const result = await runIdentityV1Conformance(provider);

    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("rejects tampered payloads", async () => {
    const provider = createHeartwoodIdentityProvider();
    const identity = await provider.create("Tamper Test");
    const signature = await provider.sign(identity.id, "original");
    const result = await provider.verify(signature.signature, "tampered");

    expect(signature.algorithm).toBe(HEARTWOOD_IDENTITY_ALGORITHM);
    expect(result.valid).toBe(false);
    expect(result.identity.id).toBe(identity.id);
  });
});
