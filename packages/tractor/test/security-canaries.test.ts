import { beforeEach, describe, expect, it, vi } from "vitest";
import { SovereignNode, Tractor } from "../src/index";
import { MockIdentityAdapter, MockStorageAdapter } from "./test-utils";

describe("Security Canaries (Tripwires)", () => {
  let tractor: Tractor;

  beforeEach(async () => {
    tractor = await Tractor.boot({
      storage: new MockStorageAdapter(),
      identity: new MockIdentityAdapter(),
    });
    await tractor.enableGuestMode();
  });

  it("should block storage if verifyNode fails (Tampering Canary)", async () => {
    // 1. Create a seemingly valid node
    const node: SovereignNode = {
      "@context": "https://refarm.dev/schemas/v1",
      "@type": "Note",
      "@id": "urn:refarm:note:1",
      "text": "Secret info"
    };

    // 2. We want to simulate a failure in verifyNode.
    // Since Tractor.storeNode calls signNode then verifyNode, 
    // we need to mock verifyNode to return false or mock signNode to produce bad sig.
    
    const verifySpy = vi.spyOn(tractor, "verifyNode").mockResolvedValue(false);
    const telemetrySpy = vi.fn();
    tractor.observe(telemetrySpy);

    await expect(tractor.storeNode(node)).rejects.toThrow("[tractor] Security Alert: Tampering detected");
    
    expect(telemetrySpy).toHaveBeenCalledWith(expect.objectContaining({
      event: "system:security:canary_tripped",
      payload: expect.objectContaining({ type: "tampering" })
    }));
  });

  it("should block nodes from the distant future (Clock Skew Canary)", async () => {
    const futureNode: SovereignNode = {
      "@context": "https://refarm.dev/schemas/v1",
      "@type": "Note",
      "@id": "urn:refarm:note:future",
      "timestamp": new Date(Date.now() + 1000 * 60 * 60).toISOString() // 1 hour in future
    };

    const telemetrySpy = vi.fn();
    tractor.observe(telemetrySpy);

    await expect(tractor.storeNode(futureNode)).rejects.toThrow("[tractor] Security Alert: Clock skew detected");
    
    expect(telemetrySpy).toHaveBeenCalledWith(expect.objectContaining({
      event: "system:security:canary_tripped",
      payload: expect.objectContaining({ type: "clock_skew" })
    }));
  });

  it("should allow tampered nodes with warning in Permissive Mode", async () => {
    const node: SovereignNode = {
      "@context": "https://refarm.dev/schemas/v1",
      "@type": "Note",
      "@id": "urn:refarm:note:permissive",
      "text": "Edit me"
    };

    vi.spyOn(tractor, "verifyNode").mockResolvedValue(false);
    const telemetrySpy = vi.fn();
    tractor.observe(telemetrySpy);

    await expect(tractor.storeNode(node, "permissive")).resolves.not.toThrow();
    
    expect(telemetrySpy).toHaveBeenCalledWith(expect.objectContaining({
      event: "system:security:canary_tripped",
      payload: expect.objectContaining({ type: "tampering" })
    }));
  });

  it("should skip all checks in None Mode (Fast Path)", async () => {
    const node: SovereignNode = {
      "@context": "https://refarm.dev/schemas/v1",
      "@type": "Note",
      "@id": "urn:refarm:note:none",
      "timestamp": new Date(Date.now() + 1000 * 60 * 60).toISOString() // Future
    };

    const telemetrySpy = vi.fn();
    tractor.observe(telemetrySpy);

    await expect(tractor.storeNode(node, "none")).resolves.not.toThrow();
    
    // Should NOT trip any canary or sign (no signNode call in none mode)
    expect(telemetrySpy).not.toHaveBeenCalledWith(expect.objectContaining({
      event: "system:security:canary_tripped"
    }));

    // Verify it was stored via the mock storage
    const stored = await tractor.queryNodes("Note");
    expect(stored.some(n => n["@id"] === "urn:refarm:note:none")).toBe(true);
  });

  it("should allow nodes within the 10s grace period", async () => {
    const nearFutureNode: SovereignNode = {
      "@context": "https://refarm.dev/schemas/v1",
      "@type": "Note",
      "@id": "urn:refarm:note:near-future",
      "timestamp": new Date(Date.now() + 5000).toISOString() // 5s in future
    };

    await expect(tractor.storeNode(nearFutureNode)).resolves.not.toThrow();
  });
});
