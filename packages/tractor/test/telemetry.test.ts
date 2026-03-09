import type { IdentityAdapter } from "@refarm.dev/identity-contract-v1";
import type { StorageAdapter } from "@refarm.dev/storage-contract-v1";
import { describe, expect, it, vi } from "vitest";
import { Tractor } from "../src/index";

describe("Tractor Telemetry", () => {
  const mockStorage: StorageAdapter = {
    ensureSchema: vi.fn(),
    storeNode: vi.fn(),
    queryNodes: vi.fn().mockResolvedValue([]),
    close: vi.fn(),
  } as any;

  const mockIdentity: IdentityAdapter = {
    getSigningPublicKey: vi.fn().mockResolvedValue("pubkey"),
  } as any;

  it("should emit telemetry when a node is stored", async () => {
    const tractor = await Tractor.boot({ storage: mockStorage, identity: mockIdentity });
    const listener = vi.fn();
    tractor.observe(listener);

    await tractor.storeNode({
      "@context": "https://schema.org/",
      "@type": "TestNode",
      "@id": "urn:test:1",
      "refarm:sourcePlugin": "test-plugin"
    }, "none");

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      event: "storage:io",
      pluginId: "test-plugin",
      payload: expect.objectContaining({ action: "store", type: "TestNode" })
    }));
  });

  it("should emit telemetry when a plugin is loaded", async () => {
    const tractor = await Tractor.boot({ storage: mockStorage, identity: mockIdentity });
    const listener = vi.fn();
    tractor.observe(listener);

    // Mock fetch for wasm
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8))
    });

    await tractor.plugins.load({
      id: "hello-world",
      name: "Hello World",
      entry: "https://example.com/plugin.wasm",
      capabilities: {}
    } as any);

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      event: "plugin:load",
      pluginId: "hello-world"
    }));
  });

  it("should handle secret decryption with auth provider", async () => {
    const onAuthRequest = vi.fn().mockResolvedValue({ success: true, key: { mock: true } });
    const tractor = await Tractor.boot({
      storage: mockStorage,
      identity: mockIdentity,
      onAuthRequest
    });

    const mockSecretBlob = {
      "@type": "SovereignSecret",
      "tier": "gold",
      "jwe": { ciphertext: "..." }
    };

    const result = await tractor.secrets.decryptSecret(mockSecretBlob);
    
    expect(onAuthRequest).toHaveBeenCalledWith(expect.objectContaining({
      tier: "gold"
    }));
    expect(result).toBe("decrypted-secret-value-placeholder");
  });

  it("should return null if user denies secret decryption", async () => {
    const onAuthRequest = vi.fn().mockResolvedValue({ success: false });
    const tractor = await Tractor.boot({
      storage: mockStorage,
      identity: mockIdentity,
      onAuthRequest
    });

    const result = await tractor.secrets.decryptSecret({ tier: "gold" });
    expect(result).toBeNull();
  });
});
