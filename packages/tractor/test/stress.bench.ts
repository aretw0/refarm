/**
 * Tractor Benchmarks
 *
 * Performance benchmarks to establish baselines for the Tractor core.
 * These run via `vitest bench` and produce measurable throughput numbers.
 *
 * Run: npx vitest bench test/stress.bench.ts
 */

import type { PluginManifest } from "@refarm.dev/plugin-manifest";
import { bench, describe } from "vitest";
import { PluginHost, Tractor, normaliseToSovereignGraph } from "../src/index";
import { createMockConfig } from "./helpers/mock-adapters";

// ─── Setup ────────────────────────────────────────────────────────────────────

function stubFetchGlobal() {
  globalThis.fetch = (async () => ({
    ok: true,
    statusText: "OK",
    arrayBuffer: async () => new Uint8Array(512).buffer,
  })) as any;
}

function createBenchManifest(id: string): PluginManifest {
  return {
    id,
    name: `Manifest ${id}`,
    version: "0.1.0",
    entry: `https://mock.test/${id}.wasm`,
    capabilities: { provides: [], requires: [] },
    permissions: [],
    observability: { hooks: ["onLoad"] },
    targets: [],
    certification: { license: "MIT", a11yLevel: 1, languages: ["en"] }
  };
}

// ─── Boot Benchmark ──────────────────────────────────────────────────────────

describe("Boot", () => {
  bench("Tractor.boot() — zero-latency adapters", async () => {
    const tractor = await Tractor.boot(createMockConfig());
    await tractor.shutdown();
  });

  bench("Tractor.boot() — 10ms schema latency", async () => {
    const tractor = await Tractor.boot(createMockConfig({ schemaMs: 10 }));
    await tractor.shutdown();
  });

  bench("Tractor.boot() — with sync adapter", async () => {
    const tractor = await Tractor.boot(createMockConfig());
    await tractor.shutdown();
  });
});

// ─── Plugin Loading ──────────────────────────────────────────────────────────

describe("Plugin Loading", () => {
  stubFetchGlobal();

  bench("Load 1 plugin", async () => {
    const host = new PluginHost(() => {});
    await host.load(createBenchManifest("p1"), "hash");
    host.terminateAll();
  });

  bench("Load 10 plugins sequentially", async () => {
    const host = new PluginHost(() => {});
    for (let i = 0; i < 10; i++) {
      await host.load(createBenchManifest(`p${i}`), `h${i}`);
    }
    host.terminateAll();
  });

  bench("Load 50 plugins concurrently", async () => {
    const host = new PluginHost(() => {});
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        host.load(createBenchManifest(`p${i}`), `h${i}`)
      )
    );
    host.terminateAll();
  });

  bench("Load 100 plugins concurrently", async () => {
    const host = new PluginHost(() => {});
    await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        host.load(createBenchManifest(`p${i}`), `h${i}`)
      )
    );
    host.terminateAll();
  });
});

// ─── Storage Throughput ───────────────────────────────────────────────────────

describe("Storage Throughput", () => {
  bench("storeNode() x1", async () => {
    const config = createMockConfig();
    const tractor = await Tractor.boot(config);
    const node = normaliseToSovereignGraph(
      { "@id": "urn:bench:1", name: "Bench" },
      "bench-plugin",
      "BenchNode"
    );
    await tractor.storeNode(node);
    await tractor.shutdown();
  });

  bench("storeNode() x100 sequential", async () => {
    const config = createMockConfig();
    const tractor = await Tractor.boot(config);
    for (let i = 0; i < 100; i++) {
      const node = normaliseToSovereignGraph(
        { "@id": `urn:bench:${i}`, name: `N${i}` },
        "bench-plugin",
        "BenchNode"
      );
      await tractor.storeNode(node);
    }
    await tractor.shutdown();
  });

  bench("storeNode() x100 concurrent", async () => {
    const config = createMockConfig();
    const tractor = await Tractor.boot(config);
    await Promise.all(
      Array.from({ length: 100 }, (_, i) => {
        const node = normaliseToSovereignGraph(
          { "@id": `urn:bench:${i}`, name: `N${i}` },
          "bench-plugin",
          "BenchNode"
        );
        return tractor.storeNode(node);
      })
    );
    await tractor.shutdown();
  });
});

// ─── Normaliser ──────────────────────────────────────────────────────────────

describe("Normaliser", () => {
  bench("normaliseToSovereignGraph() x1", () => {
    normaliseToSovereignGraph({ name: "test" }, "p1", "T1");
  });

  bench("normaliseToSovereignGraph() x1000", () => {
    for (let i = 0; i < 1000; i++) {
      normaliseToSovereignGraph({ name: `item-${i}` }, "p1", "T1");
    }
  });
});

// ─── Full Lifecycle ──────────────────────────────────────────────────────────

describe("Full Lifecycle", () => {
  stubFetchGlobal();

  bench("Boot → Load 10 plugins → Store 50 nodes → Query → Shutdown", async () => {
    const config = createMockConfig();
    const tractor = await Tractor.boot(config);

    // Load plugins
    for (let i = 0; i < 10; i++) {
      await tractor.plugins.load(createBenchManifest(`p${i}`), `h${i}`);
    }

    // Store nodes
    for (let i = 0; i < 50; i++) {
      const node = normaliseToSovereignGraph(
        { "@id": `urn:lc:${i}`, name: `LC ${i}` },
        "lifecycle-plugin",
        "LifecycleNode"
      );
      await tractor.storeNode(node);
    }

    // Query
    await tractor.queryNodes("LifecycleNode");

    // Shutdown
    await tractor.shutdown();
  });
});
