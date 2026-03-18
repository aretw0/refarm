import { describe, expect, it, vi } from "vitest";
import { PluginInstanceHandle } from "../src/lib/instance-handle";
import { createMockManifest } from "@refarm.dev/plugin-manifest";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function makeHandle(componentInstance: any) {
  const emit = vi.fn();
  const onTerminate = vi.fn();
  const manifest = createMockManifest({ id: "handle-plugin", name: "Handle Plugin" });
  const instance = new PluginInstanceHandle(
    "handle-plugin",
    "Handle Plugin",
    manifest,
    componentInstance,
    emit,
    onTerminate,
  );
  return { instance, emit, onTerminate };
}

// ---------------------------------------------------------------------------
// call() routing
// ---------------------------------------------------------------------------
describe("PluginInstanceHandle.call()", () => {
  it("returns null when componentInstance is null", async () => {
    const { instance } = makeHandle(null);
    const result = await instance.call("setup");
    expect(result).toBeNull();
  });

  it("routes to componentInstance.integration[fn] when present", async () => {
    const setupFn = vi.fn().mockResolvedValue("integration-result");
    const { instance } = makeHandle({ integration: { setup: setupFn } });

    const result = await instance.call("setup", { foo: 1 });

    expect(setupFn).toHaveBeenCalledWith({ foo: 1 });
    expect(result).toBe("integration-result");
  });

  it("falls back to direct componentInstance[fn] when no integration", async () => {
    const setupFn = vi.fn().mockResolvedValue("direct-result");
    const { instance } = makeHandle({ setup: setupFn });

    const result = await instance.call("setup", "arg");

    expect(setupFn).toHaveBeenCalledWith("arg");
    expect(result).toBe("direct-result");
  });

  it("prefers integration.fn over direct method when both exist", async () => {
    const integrationFn = vi.fn().mockResolvedValue("integration wins");
    const directFn = vi.fn().mockResolvedValue("direct loses");
    const { instance } = makeHandle({
      integration: { setup: integrationFn },
      setup: directFn,
    });

    const result = await instance.call("setup");

    expect(integrationFn).toHaveBeenCalled();
    expect(directFn).not.toHaveBeenCalled();
    expect(result).toBe("integration wins");
  });

  it("returns null when componentInstance has no matching method", async () => {
    const { instance } = makeHandle({ otherMethod: vi.fn() });
    const result = await instance.call("setup");
    expect(result).toBeNull();
  });

  it("returns null when integration exists but fn is not a function", async () => {
    const { instance } = makeHandle({ integration: { setup: "not-a-function" } });
    // Falls through to direct check — no direct setup either
    const result = await instance.call("setup");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// call() telemetry
// ---------------------------------------------------------------------------
describe("PluginInstanceHandle.call() — telemetry", () => {
  it("emits api:call with pluginId, fn, args, result, and durationMs", async () => {
    const setupFn = vi.fn().mockResolvedValue("ok");
    const { instance, emit } = makeHandle({ setup: setupFn });

    await instance.call("setup", { a: 1 });

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "api:call",
        pluginId: "handle-plugin",
        durationMs: expect.any(Number),
        payload: expect.objectContaining({ fn: "setup", args: { a: 1 }, result: "ok" }),
      }),
    );
  });

  it("still emits api:call when componentInstance is null (result = null)", async () => {
    const { instance, emit } = makeHandle(null);
    await instance.call("ping");

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ event: "api:call", payload: expect.objectContaining({ fn: "ping", result: null }) }),
    );
  });
});

// ---------------------------------------------------------------------------
// terminate()
// ---------------------------------------------------------------------------
describe("PluginInstanceHandle.terminate()", () => {
  it("calls onTerminate with the plugin id", () => {
    const { instance, onTerminate } = makeHandle(null);
    instance.terminate();
    expect(onTerminate).toHaveBeenCalledWith("handle-plugin");
  });

  it("emits plugin:terminate event", () => {
    const { instance, emit } = makeHandle(null);
    instance.terminate();
    expect(emit).toHaveBeenCalledWith({ event: "plugin:terminate", pluginId: "handle-plugin" });
  });
});

// ---------------------------------------------------------------------------
// emitTelemetry()
// ---------------------------------------------------------------------------
describe("PluginInstanceHandle.emitTelemetry()", () => {
  it("calls emit with event, pluginId and payload", () => {
    const { instance, emit } = makeHandle(null);
    instance.emitTelemetry("plugin:custom", { score: 0.9 });

    expect(emit).toHaveBeenCalledWith({
      event: "plugin:custom",
      pluginId: "handle-plugin",
      payload: { score: 0.9 },
    });
  });
});
