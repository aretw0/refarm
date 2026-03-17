import { describe, it, expect } from "vitest";
import {
  encodeAction,
  resolveActionIndex,
  ACTION_VOCAB,
  ACTION_UNKNOWN,
  N_ACTIONS,
} from "./action-encoder";

describe("resolveActionIndex", () => {
  it("resolves exact event name", () => {
    expect(resolveActionIndex("storage:io.storeNode")).toBe(ACTION_VOCAB["storage:io.storeNode"]);
    expect(resolveActionIndex("plugin:load")).toBe(ACTION_VOCAB["plugin:load"]);
  });

  it("resolves prefix match for dotted events", () => {
    // "api:call.OutputApi" → "api:call"
    expect(resolveActionIndex("api:call.OutputApi")).toBe(ACTION_VOCAB["api:call"]);
    expect(resolveActionIndex("api:call.SomeOtherApi")).toBe(ACTION_VOCAB["api:call"]);
  });

  it("returns ACTION_UNKNOWN for unrecognised events", () => {
    expect(resolveActionIndex("foo:bar.baz")).toBe(ACTION_UNKNOWN);
    expect(resolveActionIndex("unknown:event")).toBe(ACTION_UNKNOWN);
  });
});

describe("encodeAction", () => {
  it("returns Float32Array of length N_ACTIONS", () => {
    const vec = encodeAction({ event: "plugin:load" });
    expect(vec.length).toBe(N_ACTIONS);
    expect(vec).toBeInstanceOf(Float32Array);
  });

  it("is a 1-hot vector (exactly one 1.0)", () => {
    const vec = encodeAction({ event: "storage:io.storeNode" });
    const ones = Array.from(vec).filter((v) => v === 1.0);
    expect(ones.length).toBe(1);
    expect(Array.from(vec).every((v) => v === 0 || v === 1)).toBe(true);
  });

  it("different events produce different vectors", () => {
    const v1 = encodeAction({ event: "plugin:load" });
    const v2 = encodeAction({ event: "plugin:terminate" });
    expect(Array.from(v1)).not.toEqual(Array.from(v2));
  });

  it("unknown events produce a 1-hot at index 0", () => {
    const vec = encodeAction({ event: "completely:unknown:event" });
    expect(vec[ACTION_UNKNOWN]).toBe(1.0);
  });
});
