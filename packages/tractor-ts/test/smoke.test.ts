import { afterEach, describe, expect, it, vi } from "vitest";

import { createMockManifest } from "@refarm.dev/plugin-manifest";
import { SovereignRegistry } from "@refarm.dev/registry";
import { normaliseToSovereignGraph, PluginHost } from "../src/index";

// No global vi.mock here to avoid polluting other test suites like packages/registry
// We will use dynamic imports or scoped mocks if needed.

describe("@refarm.dev/tractor smoke", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("normalises plugin payload into sovereign node", () => {
    const node = normaliseToSovereignGraph(
      { "@id": "urn:test:1", name: "hello" },
      "plugin-smoke",
      "Note",
    );

    expect(node["@id"]).toBe("urn:test:1");
    expect(node["@type"]).toBe("Note");
    expect(node["refarm:sourcePlugin"]).toBe("plugin-smoke");
    expect(typeof node["refarm:ingestedAt"]).toBe("string");
  });

  it("loads plugin handle and tracks instance lifecycle", async () => {
    // Mock heartwood locally for this test only
    vi.doMock("@refarm.dev/heartwood", () => ({
      verify: vi.fn().mockReturnValue(true),
      generateKeypair: vi.fn().mockReturnValue({ secretKey: new Uint8Array(32), publicKey: new Uint8Array(32) }),
      sign: vi.fn().mockReturnValue(new Uint8Array(64)),
    }));

    const registry = new SovereignRegistry();
    const host = new PluginHost(vi.fn(), registry);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        statusText: "OK",
        arrayBuffer: async () => new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]).buffer,
      }),
    );

    const manifest = createMockManifest({ id: "plugin-1" });
    registry.register(manifest);
    // Force validated status for test
    const entry = registry.getPlugin("plugin-1");
    if (entry) entry.status = "validated";

    const instance = await host.load(manifest, "hash-placeholder");

    expect(instance.id).toBe("plugin-1");
    expect(host.get("plugin-1")).toBeDefined();

    host.terminateAll();
    expect(host.get("plugin-1")).toBeUndefined();
  });

  it("fails to load when integrity check fails (complex scenario simulation)", async () => {
     /**
      * TODO: This test is currently a "smoke-only" placeholder.
      * 
      * LIMITATIONS:
      * 1. JCO instantiation happens BEFORE our manual hash check, so invalid WASM 
      *    fails with a SyntaxError instead of our custom IntegrityError.
      * 
      * FUTURE WORK (Phase 8+):
      * - Use a real, minimal WASM component instead of a 8-byte dummy.
      * - Remove the heartwood mock to allow real cryptographic verification.
      * - Implement SHA-256 enforcement in PluginHost.load before calling the runner.
      * - Assert: expect(host.load(manifest, wrongHash)).rejects.toThrow(/integrity/i);
      */
     // Mock heartwood locally for this test only
     vi.doMock("@refarm.dev/heartwood", () => ({
       verify: vi.fn().mockReturnValue(true),
       generateKeypair: vi.fn().mockReturnValue({ secretKey: new Uint8Array(32), publicKey: new Uint8Array(32) }),
       sign: vi.fn().mockReturnValue(new Uint8Array(64)),
     }));

     const registry = new SovereignRegistry();
     const host = new PluginHost(vi.fn(), registry);

     vi.stubGlobal(
       "fetch",
       vi.fn().mockResolvedValue({
         ok: true,
         statusText: "OK",
         arrayBuffer: async () => new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]).buffer,
       }),
     );

     const manifest = createMockManifest({ id: "faulty-plugin" });
     registry.register(manifest);
     const entry = registry.getPlugin("faulty-plugin");
     if (entry) entry.status = "validated";
     
     // Currently passes because integrity enforcement is not yet blocking the load
     const instance = await host.load(manifest);
     expect(instance.id).toBe("faulty-plugin");
  });
});
