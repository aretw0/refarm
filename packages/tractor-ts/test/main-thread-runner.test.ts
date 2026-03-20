import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MainThreadRunner } from "../src/lib/main-thread-runner";
import { createMockManifest } from "@refarm.dev/plugin-manifest";

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted by Vitest)
// ---------------------------------------------------------------------------
vi.mock("@bytecodealliance/jco", () => ({
  transpile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(Buffer.from("")),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const manifest = createMockManifest({ id: "test_plugin", name: "Test Plugin" });
const wasmBuffer = new Uint8Array([0x00, 0x61, 0x73, 0x6d]).buffer;

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("MainThreadRunner", () => {
  let jco: typeof import("@bytecodealliance/jco");
  let fsMock: typeof import("node:fs/promises");

  beforeEach(async () => {
    jco = await import("@bytecodealliance/jco");
    fsMock = await import("node:fs/promises");
    vi.mocked(fsMock.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsMock.writeFile).mockResolvedValue(undefined);
    vi.mocked(fsMock.readdir).mockResolvedValue([] as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("supports() returns true in a Node.js environment", () => {
    const runner = new MainThreadRunner("/tmp/test-dist");
    expect(runner.supports(manifest)).toBe(true);
  });

  it("JCO transpile throws → returns PluginInstanceHandle with null component", async () => {
    const logger = makeLogger();
    vi.mocked(jco.transpile).mockRejectedValueOnce(new Error("bad wasm bytes"));

    const runner = new MainThreadRunner("/tmp/test-dist", logger);
    const emit = vi.fn();
    const onTerminate = vi.fn();

    const instance = await runner.instantiate(manifest, wasmBuffer, {}, emit, onTerminate);

    expect(instance.id).toBe("test_plugin");
    expect(instance.name).toBe("Test Plugin");
    expect(instance.manifest).toBe(manifest);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("JCO instantiation failed for test_plugin")
    );

    // Calling a function on the null-component instance returns null
    const result = await instance.call("setup");
    expect(result).toBeNull();
  });

  it("JCO transpile throws 'wasm module with component parser' → caught gracefully", async () => {
    const logger = makeLogger();
    vi.mocked(jco.transpile).mockRejectedValueOnce(
      new Error("attempted to parse a wasm module with a component parser")
    );

    const runner = new MainThreadRunner("/tmp/test-dist", logger);
    const instance = await runner.instantiate(manifest, wasmBuffer, {}, vi.fn(), vi.fn());

    expect(instance.id).toBe("test_plugin");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("attempted to parse a wasm module with a component parser")
    );
  });

  it("JCO succeeds but no matching entry point → 'No JS entry point' → caught", async () => {
    const logger = makeLogger();
    // Return files with keys that don't match the jcoName
    vi.mocked(jco.transpile).mockResolvedValueOnce({
      files: { "other_plugin.core.wasm": new Uint8Array([0]) },
    } as any);
    // readdir also returns empty so there's no fallback
    vi.mocked(fsMock.readdir).mockResolvedValueOnce([] as any);

    const runner = new MainThreadRunner("/tmp/test-dist", logger);
    const instance = await runner.instantiate(manifest, wasmBuffer, {}, vi.fn(), vi.fn());

    expect(instance.id).toBe("test_plugin");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("No JS entry point found for test_plugin")
    );
  });

  it("JCO succeeds, readdir fallback finds a .js file → entry point resolved", async () => {
    const logger = makeLogger();
    // Return a WASM file only — jcoName.js is absent, so we fall to readdir
    vi.mocked(jco.transpile).mockResolvedValueOnce({
      files: { "test_plugin.core.wasm": new Uint8Array([0]) },
    } as any);
    // readdir returns a .js file as the fallback
    vi.mocked(fsMock.readdir).mockResolvedValueOnce(["test_plugin.js"] as any);

    const runner = new MainThreadRunner("/tmp/test-dist", logger);
    const instance = await runner.instantiate(manifest, wasmBuffer, {}, vi.fn(), vi.fn());

    // The import() of the resolved path will fail (file doesn't exist on disk)
    // but the runner degrades gracefully and returns a handle
    expect(instance.id).toBe("test_plugin");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("JCO succeeds with matching entry file → files written to distDir → import attempted", async () => {
    const logger = makeLogger();
    // Return files including the expected jcoName.js
    vi.mocked(jco.transpile).mockResolvedValueOnce({
      files: {
        "test_plugin.js": Buffer.from("export default {}"),
        "test_plugin.core.wasm": new Uint8Array([0]),
      },
    } as any);

    const runner = new MainThreadRunner("/tmp/test-dist", logger);
    const instance = await runner.instantiate(manifest, wasmBuffer, {}, vi.fn(), vi.fn());

    // fs.mkdir and fs.writeFile should have been called for each output file
    expect(fsMock.mkdir).toHaveBeenCalled();
    expect(fsMock.writeFile).toHaveBeenCalled();

    // The dynamic import will fail (the path resolves to a non-existent file),
    // but the runner degrades gracefully
    expect(instance.id).toBe("test_plugin");
  });

  it("returned PluginInstanceHandle emits telemetry on call()", async () => {
    const logger = makeLogger();
    vi.mocked(jco.transpile).mockRejectedValueOnce(new Error("dummy"));

    const emit = vi.fn();
    const runner = new MainThreadRunner("/tmp/test-dist", logger);
    const instance = await runner.instantiate(manifest, wasmBuffer, {}, emit, vi.fn());

    await instance.call("setup");

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ event: "api:call", pluginId: "test_plugin" })
    );
  });

  it("returned PluginInstanceHandle fires onTerminate on terminate()", async () => {
    const logger = makeLogger();
    vi.mocked(jco.transpile).mockRejectedValueOnce(new Error("dummy"));

    const onTerminate = vi.fn();
    const emit = vi.fn();
    const runner = new MainThreadRunner("/tmp/test-dist", logger);
    const instance = await runner.instantiate(manifest, wasmBuffer, {}, emit, onTerminate);

    instance.terminate();

    expect(onTerminate).toHaveBeenCalledWith("test_plugin");
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ event: "plugin:terminate", pluginId: "test_plugin" })
    );
  });
});
