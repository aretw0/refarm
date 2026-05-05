import { PluginManifest } from "@refarm.dev/plugin-manifest";
import { SovereignRegistry } from "@refarm.dev/registry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginHost } from "../src/index";

vi.mock("@refarm.dev/heartwood", () => ({
  verify: vi.fn().mockReturnValue(true),
}));

function createStrictManifest(): PluginManifest {
  return {
    id: "@refarm.dev/test-plugin",
    name: "Test Plugin",
    version: "0.1.0",
    entry: "https://example.test/test.wasm",
    capabilities: { provides: [], requires: [], allowedOrigins: [] },
    permissions: [],
    observability: { hooks: [] },
    targets: ["browser"],
    certification: { license: "MIT", a11yLevel: 1, languages: ["en"] },
    trust: { profile: "strict" },
  };
}

describe("PluginHost registry validation gate", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        statusText: "OK",
        arrayBuffer: async () => new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]).buffer,
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws in strict mode (default) if plugin is not in registry", async () => {
    const registry = new SovereignRegistry();
    const host = new PluginHost(vi.fn(), registry);
    const manifest = createStrictManifest();
    // intentionally NOT registering in registry

    await expect(host.load(manifest)).rejects.toThrow(/not validated.*unregistered/i);
  });

  it("throws in strict mode if plugin status is 'registered' (not yet validated)", async () => {
    const registry = new SovereignRegistry();
    const host = new PluginHost(vi.fn(), registry);
    const manifest = createStrictManifest();
    registry.register(manifest);
    // status is "registered" after register(), before validation

    await expect(host.load(manifest)).rejects.toThrow(/not validated/i);
  });

  it("warns (does not throw) in permissive mode for unregistered plugin", async () => {
    const registry = new SovereignRegistry();
    const warnSpy = vi.fn();
    const logger = { info: vi.fn(), warn: warnSpy, debug: vi.fn(), error: vi.fn() };
    const host = new PluginHost(vi.fn(), registry, logger, "permissive");
    const manifest = createStrictManifest();
    // NOT in registry — permissive mode should warn and continue

    await expect(host.load(manifest)).resolves.toBeDefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/not validated.*unregistered/i));
  });

  it("allows loading of a validated plugin in strict mode", async () => {
    const registry = new SovereignRegistry();
    const host = new PluginHost(vi.fn(), registry);
    const manifest = createStrictManifest();
    registry.register(manifest);
    const entry = registry.getPlugin(manifest.id);
    if (entry) entry.status = "validated";

    await expect(host.load(manifest)).resolves.toBeDefined();
  });
});

function createManifest(profile: "strict" | "trusted-fast"): PluginManifest {
  return {
    id: "@refarm.dev/high-perf-plugin",
    name: "High Perf Plugin",
    version: "0.1.0",
    entry: "https://example.test/high-perf.wasm",
    capabilities: {
      provides: ["compute:v1"],
      requires: [],
      allowedOrigins: ["https://example.test"],
    },
    permissions: [],
    observability: {
      hooks: ["onLoad", "onInit", "onRequest", "onError", "onTeardown"],
    },
    targets: ["browser"],
    certification: {
      license: "MIT",
      a11yLevel: 1,
      languages: ["en"],
    },
    trust: {
      profile,
    },
  };
}

describe("PluginHost trust grants", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        statusText: "OK",
        arrayBuffer: async () => new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]).buffer,
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blocks trusted-fast profile without an explicit grant", async () => {
    const registry = new SovereignRegistry();
    const host = new PluginHost(vi.fn(), registry);
    const manifest = createManifest("trusted-fast");
    registry.register(manifest);
    const entry = registry.getPlugin(manifest.id);
    if (entry) entry.status = "validated";

    await expect(
      host.load(manifest, "sha256:plugin-v1")
    ).rejects.toThrow(/Trusted-fast denied/);
  });

  it("blocks trusted-fast profile when wasm hash is missing", async () => {
    const registry = new SovereignRegistry();
    const host = new PluginHost(vi.fn(), registry);
    const manifest = createManifest("trusted-fast");
    registry.register(manifest);
    const entry = registry.getPlugin(manifest.id);
    if (entry) entry.status = "validated";

    await expect(
      host.load(manifest)
    ).rejects.toThrow(/Trusted-fast requires wasmHash/);
  });

  it("allows trusted-fast profile after granting trust for that hash", async () => {
    const registry = new SovereignRegistry();
    const host = new PluginHost(vi.fn(), registry);
    const manifest = createManifest("trusted-fast");
    registry.register(manifest);
    const entry = registry.getPlugin(manifest.id);
    if (entry) entry.status = "validated";

    host.grantTrust("@refarm.dev/high-perf-plugin", "sha256:plugin-v1", 60_000);

    await expect(
      host.load(manifest, "sha256:plugin-v1")
    ).resolves.toBeDefined();
  });

  it("supports trust-once grant derived from manifest lease", async () => {
    const registry = new SovereignRegistry();
    const host = new PluginHost(vi.fn(), registry);
    const manifest = createManifest("trusted-fast");
    manifest.trust = { profile: "trusted-fast", leaseHours: 1 };
    registry.register(manifest);
    const entry = registry.getPlugin(manifest.id);
    if (entry) entry.status = "validated";

    host.trustManifestOnce(manifest, "sha256:plugin-v2");

    await expect(
      host.load(manifest, "sha256:plugin-v2")
    ).resolves.toBeDefined();
  });

  it("revokes trusted-fast grant when wasm hash changes", async () => {
    const registry = new SovereignRegistry();
    const host = new PluginHost(vi.fn(), registry);
    const manifest = createManifest("trusted-fast");
    registry.register(manifest);
    const entry = registry.getPlugin(manifest.id);
    if (entry) entry.status = "validated";

    host.grantTrust("@refarm.dev/high-perf-plugin", "sha256:old", 60_000);

    await expect(
      host.load(manifest, "sha256:new")
    ).rejects.toThrow(/wasm hash changed/);

    await expect(
      host.load(manifest, "sha256:old")
    ).rejects.toThrow("Trusted-fast denied");
  });

  it("rejects trusted-fast profile for non-wasm entry formats", async () => {
    const registry = new SovereignRegistry();
    const host = new PluginHost(vi.fn(), registry);
    const manifest = createManifest("trusted-fast");
    manifest.entry = "https://example.test/high-perf.mjs";
    registry.register(manifest);
    const entry = registry.getPlugin(manifest.id);
    if (entry) entry.status = "validated";

    await expect(
      host.load(manifest, "sha256:plugin-v1")
    ).rejects.toThrow(/Trusted-fast is only available for \.wasm/);
  });
});
