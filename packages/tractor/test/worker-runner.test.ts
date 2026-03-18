import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkerRunner } from "../src/lib/worker-runner";
import { createMockManifest } from "@refarm.dev/plugin-manifest";

// ---------------------------------------------------------------------------
// Mock Worker factory
// ---------------------------------------------------------------------------
function createMockWorker() {
  let messageHandler: ((ev: { data: any }) => void) | null = null;

  const workerInstance = {
    addEventListener: vi.fn((type: string, handler: any) => {
      if (type === "message") messageHandler = handler;
    }),
    postMessage: vi.fn((msg: any) => {
      // Auto-respond to "call" messages so callWorker() promises resolve.
      // Use a microtask so the Promise chain in callWorker() is set up first.
      if (msg.type === "call" && messageHandler) {
        Promise.resolve().then(() =>
          messageHandler!({ data: { type: "result", id: msg.id, result: "ok" } })
        );
      }
    }),
    terminate: vi.fn(),
  };

  const fireMessage = (data: any) => messageHandler?.({ data });

  return { workerInstance, fireMessage };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("WorkerRunner", () => {
  let mockWorker: ReturnType<typeof createMockWorker>;
  const manifest = createMockManifest({ id: "worker-plugin-1", entry: "https://example.test/worker.js" });

  beforeEach(() => {
    mockWorker = createMockWorker();
    // Must be a regular function (not arrow) so it can be called with `new`.
    // Returning an object from a constructor causes `new` to use that object.
    vi.stubGlobal("Worker", vi.fn(function WorkerMock() { return mockWorker.workerInstance; }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("supports() returns true when Worker global is defined", () => {
    const runner = new WorkerRunner();
    expect(runner.supports(manifest)).toBe(true);
  });

  it("supports() returns false when Worker is not defined", () => {
    vi.unstubAllGlobals();
    // Remove Worker from globals
    const original = (globalThis as any).Worker;
    delete (globalThis as any).Worker;
    try {
      const runner = new WorkerRunner();
      expect(runner.supports(manifest)).toBe(false);
    } finally {
      if (original) (globalThis as any).Worker = original;
    }
  });

  it("instantiate() resolves with a PluginInstance having correct id and name", async () => {
    const runner = new WorkerRunner();
    const emit = vi.fn();
    const onTerminate = vi.fn();

    const instance = await runner.instantiate(manifest, new ArrayBuffer(0), {}, emit, onTerminate);

    expect(instance.id).toBe("worker-plugin-1");
    expect(instance.name).toBe(manifest.name);
    expect(instance.manifest).toBe(manifest);
    expect(instance.state).toBe("running");
  });

  it("instantiate() sends setup call to Worker with wasmUrl and manifest", async () => {
    const runner = new WorkerRunner();
    const emit = vi.fn();
    const onTerminate = vi.fn();

    await runner.instantiate(manifest, new ArrayBuffer(0), {}, emit, onTerminate);

    const setupCall = mockWorker.workerInstance.postMessage.mock.calls.find(
      ([msg]) => msg.type === "call" && msg.fn === "setup"
    );
    expect(setupCall).toBeDefined();
    expect(setupCall![0].args).toMatchObject({ wasmUrl: manifest.entry, manifest });
  });

  it("bridge-call handler: invokes storeNode and replies bridge-result", async () => {
    const storeNode = vi.fn().mockResolvedValue(undefined);
    const runner = new WorkerRunner(storeNode);
    const emit = vi.fn();

    await runner.instantiate(manifest, new ArrayBuffer(0), {}, emit, vi.fn());

    mockWorker.fireMessage({ type: "bridge-call", id: "b1", fn: "store-node", args: '{"@id":"urn:test:1"}' });

    // Give the async bridge handler a tick to complete
    await Promise.resolve();
    await Promise.resolve();

    expect(storeNode).toHaveBeenCalledWith('{"@id":"urn:test:1"}');
    expect(mockWorker.workerInstance.postMessage).toHaveBeenCalledWith({
      type: "bridge-result",
      id: "b1",
      result: "ok",
    });
  });

  it("bridge-call handler: storeNode throws → replies bridge-error", async () => {
    const storeNode = vi.fn().mockRejectedValue(new Error("disk full"));
    const runner = new WorkerRunner(storeNode);

    await runner.instantiate(manifest, new ArrayBuffer(0), {}, vi.fn(), vi.fn());

    mockWorker.fireMessage({ type: "bridge-call", id: "b2", fn: "store-node", args: "{}" });

    await Promise.resolve();
    await Promise.resolve();

    expect(mockWorker.workerInstance.postMessage).toHaveBeenCalledWith({
      type: "bridge-error",
      id: "b2",
      message: "disk full",
    });
  });

  it("bridge-call handler: fn is not store-node → replies bridge-result without calling storeNode", async () => {
    const storeNode = vi.fn();
    const runner = new WorkerRunner(storeNode);

    await runner.instantiate(manifest, new ArrayBuffer(0), {}, vi.fn(), vi.fn());

    mockWorker.fireMessage({ type: "bridge-call", id: "b3", fn: "unknown-fn", args: "{}" });

    await Promise.resolve();
    await Promise.resolve();

    expect(storeNode).not.toHaveBeenCalled();
    expect(mockWorker.workerInstance.postMessage).toHaveBeenCalledWith({
      type: "bridge-result",
      id: "b3",
      result: "ok",
    });
  });

  it("result message resolves pending instance.call() promise", async () => {
    const runner = new WorkerRunner();
    const emit = vi.fn();

    const instance = await runner.instantiate(manifest, new ArrayBuffer(0), {}, emit, vi.fn());

    // Capture the next postMessage (the call we'll make) to extract its id
    let capturedCallId: string | undefined;
    const origPostMessage = mockWorker.workerInstance.postMessage;
    mockWorker.workerInstance.postMessage = vi.fn((msg: any) => {
      origPostMessage(msg);
      if (msg.type === "call" && msg.fn === "ping") capturedCallId = msg.id;
    });

    // Prevent auto-response for this call by re-mocking without auto-respond
    mockWorker.workerInstance.postMessage = vi.fn((msg: any) => {
      if (msg.type === "call" && msg.fn === "ping") capturedCallId = msg.id;
      // Do NOT auto-respond — we'll fire manually
    });

    const callPromise = instance.call("ping");

    // Give the promise setup time
    await Promise.resolve();
    expect(capturedCallId).toBeDefined();

    mockWorker.fireMessage({ type: "result", id: capturedCallId!, result: "pong" });

    const result = await callPromise;
    expect(result).toBe("pong");
  });

  it("error message rejects pending instance.call() promise", async () => {
    const runner = new WorkerRunner();

    const instance = await runner.instantiate(manifest, new ArrayBuffer(0), {}, vi.fn(), vi.fn());

    let capturedCallId: string | undefined;
    mockWorker.workerInstance.postMessage = vi.fn((msg: any) => {
      if (msg.type === "call") capturedCallId = msg.id;
    });

    const callPromise = instance.call("boom");
    await Promise.resolve();

    mockWorker.fireMessage({ type: "error", id: capturedCallId!, message: "worker crashed" });

    await expect(callPromise).rejects.toThrow("worker crashed");
  });

  it("telemetry message calls emit with the event and pluginId", async () => {
    const emit = vi.fn();
    const runner = new WorkerRunner();

    await runner.instantiate(manifest, new ArrayBuffer(0), {}, emit, vi.fn());

    mockWorker.fireMessage({
      type: "telemetry",
      event: "plugin:log",
      payload: { message: "hello" },
    });

    expect(emit).toHaveBeenCalledWith({
      event: "plugin:log",
      pluginId: "worker-plugin-1",
      payload: { message: "hello" },
    });
  });

  it("unknown message type is silently ignored", async () => {
    const runner = new WorkerRunner();

    const instance = await runner.instantiate(manifest, new ArrayBuffer(0), {}, vi.fn(), vi.fn());

    // Should not throw
    expect(() =>
      mockWorker.fireMessage({ type: "completely-unknown", id: "x1", result: "whatever" })
    ).not.toThrow();

    expect(instance.id).toBe("worker-plugin-1");
  });

  it("message with unknown result id is silently ignored", async () => {
    const runner = new WorkerRunner();

    await runner.instantiate(manifest, new ArrayBuffer(0), {}, vi.fn(), vi.fn());

    // Fire result for an id that's not in pendingCalls
    expect(() =>
      mockWorker.fireMessage({ type: "result", id: "nonexistent-id", result: "whatever" })
    ).not.toThrow();
  });

  it("terminate() sends terminate message, calls worker.terminate() and onTerminate", async () => {
    const onTerminate = vi.fn();
    const emit = vi.fn();
    const runner = new WorkerRunner();

    const instance = await runner.instantiate(manifest, new ArrayBuffer(0), {}, emit, onTerminate);

    instance.terminate();

    expect(mockWorker.workerInstance.postMessage).toHaveBeenCalledWith({ type: "terminate" });
    expect(mockWorker.workerInstance.terminate).toHaveBeenCalled();
    expect(onTerminate).toHaveBeenCalledWith("worker-plugin-1");
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ event: "plugin:terminate", pluginId: "worker-plugin-1" })
    );
  });

  it("emitTelemetry() on the instance calls emit with event and pluginId", async () => {
    const emit = vi.fn();
    const runner = new WorkerRunner();

    const instance = await runner.instantiate(manifest, new ArrayBuffer(0), {}, emit, vi.fn());

    instance.emitTelemetry("plugin:custom", { value: 42 });

    expect(emit).toHaveBeenCalledWith({
      event: "plugin:custom",
      pluginId: "worker-plugin-1",
      payload: { value: 42 },
    });
  });
});
