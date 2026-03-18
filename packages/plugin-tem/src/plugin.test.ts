import { describe, it, expect, beforeEach } from "vitest";
import { integration, setStoreNodeFn } from "./plugin";

beforeEach(() => {
  // Reset registered fn between tests
  setStoreNodeFn(null);
});

describe("storeNoveltyNode", () => {
  it("chama a fn registrada após onEvent", async () => {
    const stored: string[] = [];
    setStoreNodeFn(async (nodeJson) => {
      stored.push(nodeJson);
    });

    integration.setup();
    integration.onEvent("system:test", JSON.stringify({ node: { id: "x" } }));

    // storeNoveltyNode is fire-and-forget — give the microtask time to settle
    await new Promise((r) => setTimeout(r, 20));

    expect(stored.length).toBe(1);
    const node = JSON.parse(stored[0]);
    expect(node["@type"]).toBe("refarm:TemMemory");
    expect(node["refarm:triggerEvent"]).toBe("system:test");
    expect(typeof node["refarm:noveltyScore"]).toBe("number");
    expect(typeof node["refarm:predictionConfidence"]).toBe("number");
    expect(node["refarm:sourcePlugin"]).toBe("refarm:tem");
  });

  it("não lança quando nenhuma fn está registrada", () => {
    integration.setup();
    expect(() =>
      integration.onEvent("system:test", JSON.stringify({ node: { id: "x" } }))
    ).not.toThrow();
  });
});
