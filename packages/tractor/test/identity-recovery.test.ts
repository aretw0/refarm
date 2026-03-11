import { beforeEach, describe, expect, it } from "vitest";
import { IdentityRecoveryHost, RecoveryProof, RecoveryProvider, RecoveryRequest } from "../src/index";

class MockRecoveryProvider implements RecoveryProvider {
  id = "mock-social";
  name = "Mock Social Recovery";
  
  async initiate(request: RecoveryRequest) {
    return { sessionId: "p-session-123", requiredProofs: ["signature"] };
  }

  async submitProof(sessionId: string, proof: RecoveryProof) {
    return proof.type === "signature" && proof.data.length > 0;
  }

  async finalize(sessionId: string) {
    return new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
  }
}

describe("Identity Recovery System", () => {
  let recovery: IdentityRecoveryHost;
  let provider: MockRecoveryProvider;

  beforeEach(async () => {
    recovery = new IdentityRecoveryHost();
    provider = new MockRecoveryProvider();
    recovery.registerProvider(provider);
  });

  it("should perform a full recovery flow", async () => {
    const request: RecoveryRequest = {
      providerId: "mock-social",
      identityRoot: "did:nostr:pub123",
      newDevicePubkey: "pub456",
      timestamp: Date.now()
    };

    // 1. Initiate
    const initResult = await recovery.initiateRecovery("mock-social", request);
    expect(initResult.tractorSessionId).toBeDefined();
    expect(initResult.requiredProofs).toContain("signature");

    // 2. Submit Proof
    const proofSuccess = await recovery.submitProof(initResult.tractorSessionId, {
      type: "signature",
      data: new Uint8Array([1, 2, 3])
    });
    expect(proofSuccess).toBe(true);

    // 3. Finalize
    const signature = await recovery.finalizeRecovery(initResult.tractorSessionId);
    expect(signature).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it("should fail for non-existent sessions", async () => {
    await expect(recovery.submitProof("ghost", { type: "test", data: new Uint8Array() }))
      .rejects.toThrow("[recovery] Session not found: ghost");
  });
});
