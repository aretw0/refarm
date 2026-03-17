import { describe, it, expect } from "vitest";
import { StructAwareEncoder } from "./obs-encoder";
import { N_X, SLOTS } from "./schema-slots";

const encoder = new StructAwareEncoder();

const mockNode = {
  "@type": "Person",
  "@id": "urn:test:person-1",
  "refarm:sourcePlugin": "matrix-bridge",
  "refarm:owner": "pubkey-abc",
  "refarm:clock": 42,
  "refarm:ingestedAt": new Date(Date.now() - 1000).toISOString(), // 1 second ago
};

const mockEvent = {
  event: "storage:io.storeNode",
  pluginId: "matrix-bridge",
  durationMs: 5,
};

describe("StructAwareEncoder", () => {
  it("returns Float32Array of length N_X (64)", () => {
    const vec = encoder.encode(mockNode, mockEvent);
    expect(vec.length).toBe(N_X);
    expect(vec).toBeInstanceOf(Float32Array);
  });

  it("all values are within [-1, 1]", () => {
    const vec = encoder.encode(mockNode, mockEvent);
    for (const v of vec) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("null node produces a valid vector (all dims defined)", () => {
    const vec = encoder.encode(null, { event: "plugin:load" });
    expect(vec.length).toBe(N_X);
    expect(Array.from(vec).every((v) => isFinite(v))).toBe(true);
  });

  it("different node types produce different type slots", () => {
    const node1 = { "@type": "Person", "@id": "urn:a" };
    const node2 = { "@type": "Message", "@id": "urn:b" };
    const event = { event: "storage:io.queryNodes" };

    const v1 = encoder.encode(node1, event);
    const v2 = encoder.encode(node2, event);

    const typeSlice1 = v1.slice(SLOTS.type.offset, SLOTS.type.offset + SLOTS.type.width);
    const typeSlice2 = v2.slice(SLOTS.type.offset, SLOTS.type.offset + SLOTS.type.width);

    // Different types must produce different type-slot encodings
    expect(Array.from(typeSlice1)).not.toEqual(Array.from(typeSlice2));
  });

  it("same node type produces identical type slots", () => {
    const node1 = { "@type": "Person", "@id": "urn:a" };
    const node2 = { "@type": "Person", "@id": "urn:b" };
    const event = { event: "plugin:load" };

    const v1 = encoder.encode(node1, event);
    const v2 = encoder.encode(node2, event);

    const typeSlice1 = v1.slice(SLOTS.type.offset, SLOTS.type.offset + SLOTS.type.width);
    const typeSlice2 = v2.slice(SLOTS.type.offset, SLOTS.type.offset + SLOTS.type.width);

    expect(Array.from(typeSlice1)).toEqual(Array.from(typeSlice2));
  });

  it("temporal slot encodes recency (recent node > 0 in dims 0-1)", () => {
    const vec = encoder.encode(mockNode, mockEvent);
    const temporalSlice = vec.slice(SLOTS.temporal.offset, SLOTS.temporal.offset + 3);

    // Clock is 42 → clockNorm = tanh(42/1000) ≈ 0.042
    expect(temporalSlice[0]).toBeGreaterThan(0);
    // Recent node → recency close to 1
    expect(temporalSlice[1]).toBeGreaterThan(0.9);
    // Duration 5ms → durationNorm = tanh(5/1000) ≈ 0.005
    expect(temporalSlice[2]).toBeGreaterThan(0);
    expect(temporalSlice[2]).toBeLessThan(0.1);
  });
});
