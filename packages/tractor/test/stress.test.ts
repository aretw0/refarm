/**
 * Tractor Stress Tests
 *
 * These tests push the Tractor to its limits to surface bottlenecks,
 * memory leaks, and concurrency issues before they hit production.
 *
 * Run: npx vitest run test/stress.test.ts
 */

import type { PluginManifest } from "@refarm.dev/plugin-manifest";
import { SovereignRegistry } from "@refarm.dev/registry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginHost, SILENT_LOGGER, Tractor, normaliseToSovereignGraph } from "../src/index";
import {
  MockIdentityAdapter,
  MockStorageAdapter,
  createMockConfig
} from "./helpers/mock-adapters";

vi.mock("@refarm.dev/heartwood", () => ({
  verify: vi.fn().mockReturnValue(true),
}));

// ─── Shared Mock Manifest Factory ─────────────────────────────────────────────

function createMockManifest(id: string): PluginManifest {
  return {
    id,
    name: `Manifest ${id}`,
    version: "0.1.0",
    entry: `https://mock.test/${id}.wasm`,
    targets: ["browser"],
    capabilities: { provides: [], requires: [] },
    permissions: [],
    observability: { hooks: ["onLoad"] },
    certification: { license: "MIT", a11yLevel: 0, languages: ["en"] }
  };
}

// ─── Boot Stress ──────────────────────────────────────────────────────────────

describe("Boot Stress", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      statusText: "OK",
      arrayBuffer: async () => new Uint8Array(1024).buffer,
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("boots successfully with all three adapters", async () => {
    const config = createMockConfig();
    const tractor = await Tractor.boot(config);

    expect(tractor).toBeDefined();
    expect(config.storage.stats.ensureSchema).toBe(1);
    expect(config.sync!.stats.start).toBe(1);

    await tractor.shutdown();
  });

  it("boots 50 Tractor instances sequentially", async () => {
    const tractors: Tractor[] = [];

    for (let i = 0; i < 50; i++) {
      const config = createMockConfig();
      const tractor = await Tractor.boot(config); // Boot the tractor first
      const manifest = createMockManifest(`plugin-${i}`);
      await tractor.registry.register(manifest);
      const entry = tractor.registry.getPlugin(manifest.id);
      if (entry) entry.status = "validated";
      await tractor.plugins.load(manifest); // Load plugin using the booted tractor
      tractors.push(tractor); // Push the booted tractor
    }

    expect(tractors).toHaveLength(50);

    for (const t of tractors) await t.shutdown();
  });

  it("boots 50 Tractor instances concurrently", async () => {
    const boots = Array.from({ length: 50 }, () =>
      Tractor.boot(createMockConfig())
    );

    const tractors = await Promise.all(boots);
    expect(tractors).toHaveLength(50);

    await Promise.all(tractors.map((t) => t.shutdown()));
  });

  it("reports boot time under slow adapters (100ms schema)", async () => {
    const config = createMockConfig({ schemaMs: 100 });
    const start = performance.now();
    const tractor = await Tractor.boot(config);
    const elapsed = performance.now() - start;

    // Should take ~100ms (schema) but NOT more than 500ms total
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(500);

    await tractor.shutdown();
  });

  it("rejects boot without storage adapter", async () => {
    await expect(
      Tractor.boot({ storage: null as any, identity: new MockIdentityAdapter(), namespace: "test" })
    ).rejects.toThrow("[tractor] A Storage Adapter is required to boot.");
  });

  it("rejects boot without identity adapter", async () => {
    await expect(
      Tractor.boot({ storage: new MockStorageAdapter(), identity: null as any, namespace: "test" })
    ).rejects.toThrow("[tractor] An Identity Adapter is required to boot.");
  });
});

// ─── Plugin Flood ─────────────────────────────────────────────────────────────

describe("Plugin Flood", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubFetch() {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        statusText: "OK",
        arrayBuffer: async () => new Uint8Array(1024).buffer, // 1KB mock WASM
      })
    );
  }

  async function registerAndValidate(registry: SovereignRegistry, manifest: PluginManifest) {
    await registry.register(manifest);
    const entry = registry.getPlugin(manifest.id);
    if (entry) entry.status = "validated";
  }

  it("loads 100 plugins sequentially", async () => {
    stubFetch();
    const registry = new SovereignRegistry();
    const host = new PluginHost(vi.fn(), registry, SILENT_LOGGER);

    for (let i = 0; i < 100; i++) {
      const manifest = createMockManifest(`plugin-${i}`);
      await registerAndValidate(registry, manifest);
      await host.load(manifest, `hash-${i}`);
    }

    expect(host.get("plugin-0")).toBeDefined();
    expect(host.get("plugin-99")).toBeDefined();

    host.terminateAll();
    expect(host.get("plugin-0")).toBeUndefined();
  });

  it("loads 100 plugins concurrently", async () => {
    stubFetch();
    const registry = new SovereignRegistry();
    const host = new PluginHost(vi.fn(), registry, SILENT_LOGGER);

    const manifests = Array.from({ length: 100 }, (_, i) => createMockManifest(`plugin-${i}`));
    await Promise.all(manifests.map((m) => registerAndValidate(registry, m)));

    const loads = manifests.map((m, i) => host.load(m, `hash-${i}`));

    await Promise.all(loads);

    expect(host.get("plugin-99")).toBeDefined();
    host.terminateAll();
  });

  it("loads 500 plugins concurrently within 2 seconds", async () => {
    stubFetch();
    const registry = new SovereignRegistry();
    const host = new PluginHost(vi.fn(), registry, SILENT_LOGGER);

    const manifests = Array.from({ length: 500 }, (_, i) => createMockManifest(`plugin-${i}`));
    await Promise.all(manifests.map((m) => registerAndValidate(registry, m)));

    const start = performance.now();

    const loads = manifests.map((m, i) => host.load(m, `hash-${i}`));

    await Promise.all(loads);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(2000);
    host.terminateAll();
  });

  it("handles plugin load failure gracefully", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: "Not Found",
      })
    );

    const registry = new SovereignRegistry();
    const host = new PluginHost(vi.fn(), registry, SILENT_LOGGER);

    const manifest = createMockManifest("broken-plugin");
    await registerAndValidate(registry, manifest);

    await expect(
      host.load(manifest, "hash")
    ).rejects.toThrow("[tractor] Failed to fetch plugin: Not Found");
  });

  it("plugin IDs are unique — no collisions under flood", async () => {
    stubFetch();
    const registry = new SovereignRegistry();
    const host = new PluginHost(vi.fn(), registry, SILENT_LOGGER);

    const ids = Array.from({ length: 200 }, (_, i) => `plugin-${i}`);
    const manifests = ids.map((id) => createMockManifest(id));
    await Promise.all(manifests.map((m) => registerAndValidate(registry, m)));

    await Promise.all(
      manifests.map((m, i) => host.load(m, `hash-${ids[i]}`))
    );

    // All 200 should be tracked
    const uniqueFound = ids.filter((id) => host.get(id) !== undefined);
    expect(uniqueFound).toHaveLength(200);

    host.terminateAll();
  });
});

// ─── Storage Throughput ───────────────────────────────────────────────────────

describe("Storage Throughput", () => {
  it("stores 1000 nodes sequentially", async () => {
    const config = createMockConfig();
    const tractor = await Tractor.boot(config);

    for (let i = 0; i < 1000; i++) {
      const node = normaliseToSovereignGraph(
        { "@id": `urn:test:node-${i}`, name: `Node ${i}` },
        "stress-plugin",
        "TestNode"
      );
      await tractor.storeNode(node);
    }

    expect(config.storage.stats.storeNode).toBe(1000);
    expect(config.storage.size).toBe(1000);

    await tractor.shutdown();
  });

  it("stores 1000 nodes concurrently", async () => {
    const config = createMockConfig();
    const tractor = await Tractor.boot(config);

    const writes = Array.from({ length: 1000 }, (_, i) => {
      const node = normaliseToSovereignGraph(
        { "@id": `urn:test:node-${i}`, name: `Node ${i}` },
        "stress-plugin",
        "TestNode"
      );
      return tractor.storeNode(node);
    });

    await Promise.all(writes);
    expect(config.storage.stats.storeNode).toBe(1000);

    await tractor.shutdown();
  });

  it("handles mixed read/write contention (800 writes + 200 reads)", async () => {
    const config = createMockConfig({ storeMs: 1, queryMs: 1 });
    const tractor = await Tractor.boot(config);

    const ops: Promise<any>[] = [];

    for (let i = 0; i < 1000; i++) {
      if (i % 5 === 0) {
        // Every 5th operation is a read
        ops.push(tractor.queryNodes("TestNode"));
      } else {
        const node = normaliseToSovereignGraph(
          { "@id": `urn:test:node-${i}`, name: `Node ${i}` },
          "stress-plugin",
          "TestNode"
        );
        ops.push(tractor.storeNode(node));
      }
    }

    await Promise.all(ops);

    expect(config.storage.stats.storeNode).toBe(800);
    expect(config.storage.stats.queryNodes).toBe(200);

    await tractor.shutdown();
  });
});

// ─── Normaliser Throughput ────────────────────────────────────────────────────

describe("Normaliser Throughput", () => {
  it("normalises 10,000 payloads without UUID collision", () => {
    const ids = new Set<string>();

    for (let i = 0; i < 10_000; i++) {
      const node = normaliseToSovereignGraph(
        { name: `Item ${i}` }, // no @id → forces UUID generation
        "bench-plugin",
        "BenchNode"
      );
      ids.add(node["@id"]);
    }

    // All 10k should be unique
    expect(ids.size).toBe(10_000);
  });

  it("preserves @id when supplied", () => {
    const node = normaliseToSovereignGraph(
      { "@id": "urn:explicit:1", name: "test" },
      "p1",
      "T1"
    );
    expect(node["@id"]).toBe("urn:explicit:1");
  });
});

// ─── Shutdown Grace ──────────────────────────────────────────────────────────

describe("Shutdown Grace", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("cleans up all plugins on shutdown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        statusText: "OK",
        arrayBuffer: async () => new Uint8Array(64).buffer,
      })
    );

    const config = createMockConfig();
    const tractor = await Tractor.boot(config);

    // Load 50 plugins
    for (let i = 0; i < 50; i++) {
      const manifest = createMockManifest(`p-${i}`);
      await tractor.registry.register(manifest);
      const entry = tractor.registry.getPlugin(manifest.id);
      if (entry) entry.status = "validated";
      await tractor.plugins.load(manifest, `hash-${i}`);
    }

    expect(tractor.plugins.get("p-0")).toBeDefined();
    expect(tractor.plugins.get("p-49")).toBeDefined();

    // Shutdown should terminate all + close storage
    await tractor.shutdown();

    expect(tractor.plugins.get("p-0")).toBeUndefined();
    expect(tractor.plugins.get("p-49")).toBeUndefined();
    expect(config.storage.stats.close).toBe(1);
  });

  it("shutdown is idempotent (no double-close crash)", async () => {
    const config = createMockConfig();
    const tractor = await Tractor.boot(config);

    await tractor.shutdown();
    // Second shutdown should not throw
    await tractor.shutdown();

    expect(config.storage.stats.close).toBe(2);
  });
});
