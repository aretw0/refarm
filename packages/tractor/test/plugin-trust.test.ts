import type { PluginManifest } from "@refarm.dev/plugin-manifest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginHost } from "../src/index";

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
        arrayBuffer: async () => new Uint8Array(1024).buffer,
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blocks trusted-fast profile without an explicit grant", async () => {
    const host = new PluginHost(vi.fn());

    await expect(
      host.load(createManifest("trusted-fast"), "sha256:plugin-v1")
    ).rejects.toThrow("Trusted-fast denied");
  });

  it("blocks trusted-fast profile when wasm hash is missing", async () => {
    const host = new PluginHost(vi.fn());

    await expect(
      host.load(createManifest("trusted-fast"))
    ).rejects.toThrow("Trusted-fast requires wasmHash");
  });

  it("allows trusted-fast profile after granting trust for that hash", async () => {
    const host = new PluginHost(vi.fn());
    host.grantTrust("@refarm.dev/high-perf-plugin", "sha256:plugin-v1", 60_000);

    await expect(
      host.load(createManifest("trusted-fast"), "sha256:plugin-v1")
    ).resolves.toMatchObject({
      id: "@refarm.dev/high-perf-plugin",
      state: "running",
    });
  });

  it("supports trust-once grant derived from manifest lease", async () => {
    const host = new PluginHost(vi.fn());
    const manifest = createManifest("trusted-fast");
    manifest.trust = { profile: "trusted-fast", leaseHours: 1 };

    host.trustManifestOnce(manifest, "sha256:plugin-v2");

    await expect(
      host.load(manifest, "sha256:plugin-v2")
    ).resolves.toMatchObject({
      id: "@refarm.dev/high-perf-plugin",
      state: "running",
    });
  });

  it("revokes trusted-fast grant when wasm hash changes", async () => {
    const host = new PluginHost(vi.fn());
    const manifest = createManifest("trusted-fast");

    host.grantTrust("@refarm.dev/high-perf-plugin", "sha256:old", 60_000);

    await expect(
      host.load(manifest, "sha256:new")
    ).rejects.toThrow("Trusted-fast revoked");

    await expect(
      host.load(manifest, "sha256:old")
    ).rejects.toThrow("Trusted-fast denied");
  });
});
