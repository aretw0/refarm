import { afterEach, describe, expect, it, vi } from "vitest";

import { normaliseToSovereignGraph, PluginHost } from "../src/index";

describe("@refarm/tractor smoke", () => {
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
    const host = new PluginHost();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        statusText: "OK",
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      }),
    );

    const instance = await host.load(
      "https://example.test/plugin.wasm",
      "hash-placeholder",
      "plugin-1",
    );

    expect(instance.id).toBe("plugin-1");
    expect(host.get("plugin-1")).toBeDefined();

    host.terminateAll();
    expect(host.get("plugin-1")).toBeUndefined();
  });
});
