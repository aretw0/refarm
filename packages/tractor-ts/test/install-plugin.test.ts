import { describe, it, expect, vi, beforeEach } from "vitest";
import { installPlugin } from "../src/lib/install-plugin";

// Mock OPFS cache module
vi.mock("../src/lib/opfs-plugin-cache", () => ({
  cachePlugin: vi.fn().mockResolvedValue(undefined),
  getCachedPlugin: vi.fn().mockResolvedValue(null),
  evictPlugin: vi.fn().mockResolvedValue(undefined),
}));

import { cachePlugin, getCachedPlugin } from "../src/lib/opfs-plugin-cache";

describe("installPlugin", () => {
  const mockManifest = {
    id: "test-plugin",
    name: "Test Plugin",
    version: "0.1.0",
    entry: "https://example.com/test.wasm",
    capabilities: { provides: [], requires: [] },
    permissions: [],
    targets: ["browser"],
    observability: { hooks: [] },
    certification: { license: "MIT", a11yLevel: 0, languages: ["en"] },
  } as any;

  const mockBuffer = new ArrayBuffer(1024);

  beforeEach(() => {
    vi.clearAllMocks();
    (getCachedPlugin as any).mockResolvedValue(null);
    (cachePlugin as any).mockResolvedValue(undefined);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      statusText: "OK",
      arrayBuffer: async () => mockBuffer,
    });
  });

  it("fetches WASM and caches it when not already cached", async () => {
    const result = await installPlugin(mockManifest, "https://example.com/test.wasm");

    expect(global.fetch).toHaveBeenCalledWith("https://example.com/test.wasm");
    expect(cachePlugin).toHaveBeenCalledWith("test-plugin", mockBuffer);
    expect(result.cached).toBe(false);
    expect(result.byteLength).toBe(1024);
  });

  it("returns cached version without fetching when already cached", async () => {
    const cachedBuffer = new ArrayBuffer(512);
    (getCachedPlugin as any).mockResolvedValue(cachedBuffer);

    const result = await installPlugin(mockManifest, "https://example.com/test.wasm");

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.cached).toBe(true);
    expect(result.byteLength).toBe(512);
  });

  it("bypasses cache when force: true", async () => {
    const cachedBuffer = new ArrayBuffer(512);
    (getCachedPlugin as any).mockResolvedValue(cachedBuffer);

    const result = await installPlugin(mockManifest, "https://example.com/test.wasm", { force: true });

    expect(global.fetch).toHaveBeenCalled();
    expect(result.cached).toBe(false);
  });

  it("throws when fetch fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: "Not Found",
    });

    await expect(
      installPlugin(mockManifest, "https://example.com/missing.wasm")
    ).rejects.toThrow("[installPlugin] Failed to fetch");
  });

  describe("integrity verification", () => {
    async function computeSRI(buffer: ArrayBuffer): Promise<string> {
      const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", buffer);
      const hashBytes = new Uint8Array(hashBuffer);
      let binaryString = "";
      for (const byte of hashBytes) binaryString += String.fromCharCode(byte);
      return `sha256-${btoa(binaryString)}`;
    }

    it("accepts a WASM that matches manifest.integrity", async () => {
      const integrity = await computeSRI(mockBuffer);
      const manifestWithIntegrity = { ...mockManifest, integrity };

      const result = await installPlugin(manifestWithIntegrity, "https://example.com/test.wasm");
      expect(result.cached).toBe(false);
      expect(result.byteLength).toBe(1024);
    });

    it("rejects a WASM whose hash does not match manifest.integrity", async () => {
      const tamperedBuffer = new ArrayBuffer(512); // different content
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        statusText: "OK",
        arrayBuffer: async () => tamperedBuffer,
      });
      const integrity = await computeSRI(mockBuffer); // hash of original, not tampered
      const manifestWithIntegrity = { ...mockManifest, integrity };

      await expect(
        installPlugin(manifestWithIntegrity, "https://example.com/test.wasm")
      ).rejects.toThrow("[installPlugin] Integrity check failed");
    });

    it("skips verification when manifest has no integrity field", async () => {
      // mockManifest has no integrity — should succeed without any hash check
      const result = await installPlugin(mockManifest, "https://example.com/test.wasm");
      expect(result.cached).toBe(false);
    });

    it("rejects an unsupported integrity algorithm", async () => {
      const manifestWithBadAlgo = { ...mockManifest, integrity: "md5-abc123" };

      await expect(
        installPlugin(manifestWithBadAlgo, "https://example.com/test.wasm")
      ).rejects.toThrow("Unsupported integrity algorithm");
    });
  });
});
