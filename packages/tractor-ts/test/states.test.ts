import type { IdentityAdapter } from "@refarm.dev/identity-contract-v1";
import type { StorageAdapter } from "@refarm.dev/storage-contract-v1";
import { describe, expect, it, vi } from "vitest";
import { Tractor } from "../src/index";

describe("Tractor Plugin States", () => {
  const mockStorage: StorageAdapter = {
    ensureSchema: vi.fn(),
    storeNode: vi.fn(),
    queryNodes: vi.fn().mockResolvedValue([]),
    close: vi.fn(),
  } as any;

  const mockIdentity: IdentityAdapter = {
    getSigningPublicKey: vi.fn().mockResolvedValue("pubkey"),
  } as any;

  it("should initialize internal plugins with 'running' state", async () => {
    const tractor = await Tractor.boot({ storage: mockStorage, identity: mockIdentity, namespace: "test-states" });
    
    tractor.plugins.registerInternal({
      id: "my-plugin",
      name: "My Plugin",
      manifest: { id: "my-plugin" } as any,
      call: async () => null,
      terminate: () => {},
      emitTelemetry: () => {},
    } as any);

    const plugin = tractor.plugins.get("my-plugin");
    expect(plugin?.state).toBe("running");
  });

  it("should transition state and emit event", async () => {
    const tractor = await Tractor.boot({ storage: mockStorage, identity: mockIdentity, namespace: "test-states-transition" });
    const listener = vi.fn();
    tractor.observe(listener);

    tractor.plugins.registerInternal({
      id: "my-plugin",
      name: "My Plugin",
      manifest: { id: "my-plugin" } as any,
      call: async () => null,
      terminate: () => {},
      emitTelemetry: () => {},
    } as any);

    tractor.setPluginState("my-plugin", "hot");

    expect(tractor.plugins.get("my-plugin")?.state).toBe("hot");
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      event: "system:plugin_state_changed",
      pluginId: "my-plugin",
      payload: { state: "hot" }
    }));
  });
});
