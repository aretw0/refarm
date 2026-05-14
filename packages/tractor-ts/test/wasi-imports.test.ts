import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WasiImports } from "../src/lib/wasi-imports";
import { createMockManifest } from "@refarm.dev/plugin-manifest";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
type TestImports = Record<string, Record<string, (...args: unknown[]) => unknown>>;

function makeImports(
  profile: "strict" | "trusted-fast",
  allowedOrigins: string[] = [],
) {
  const emit = vi.fn();
  const logger = { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() };
  const storeNode = vi.fn().mockResolvedValue(undefined);
  const manifest = createMockManifest({
    capabilities: { allowedOrigins, provides: [], requires: [] },
  } as unknown as Partial<import("@refarm.dev/plugin-manifest").PluginManifest>);
  const wasi = new WasiImports("test-plugin", logger, emit, storeNode);
  return { imports: wasi.generate(manifest, profile) as unknown as TestImports, emit, logger, storeNode };
}

// ---------------------------------------------------------------------------
// HTTP outgoing-handler / isAllowedRequest
// ---------------------------------------------------------------------------
describe("WasiImports — HTTP outgoing-handler", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
  });

  it("trusted-fast profile: all requests are allowed and fetch is called", async () => {
    const { imports } = makeImports("trusted-fast");
    const result = await imports["wasi:http/outgoing-handler"]!.handle!("https://example.com");
    expect(result).toBeDefined();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalled();
  });

  it("strict profile, no allowedOrigins: blocks request and throws", async () => {
    const { imports } = makeImports("strict", []);
    await expect(
      imports["wasi:http/outgoing-handler"]!.handle!("https://example.com"),
    ).rejects.toThrow("HTTP request not permitted by capabilities");
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it("strict profile, matching allowedOrigin: allows and calls fetch", async () => {
    const { imports } = makeImports("strict", ["https://example.com"]);
    await imports["wasi:http/outgoing-handler"]!.handle!("https://example.com/path");
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith("https://example.com/path");
  });

  it("strict profile, non-matching origin: blocks and throws", async () => {
    const { imports } = makeImports("strict", ["https://allowed.com"]);
    await expect(
      imports["wasi:http/outgoing-handler"]!.handle!("https://blocked.com/data"),
    ).rejects.toThrow("HTTP request not permitted");
  });

  it("request is an object with url property: url is extracted correctly", async () => {
    const { imports } = makeImports("strict", ["https://api.example.com"]);
    await imports["wasi:http/outgoing-handler"]!.handle!({ url: "https://api.example.com/v1" });
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalled();
  });

  it("request object has no url: blocks request", async () => {
    const { imports } = makeImports("strict", ["https://example.com"]);
    await expect(
      imports["wasi:http/outgoing-handler"]!.handle!({ url: undefined }),
    ).rejects.toThrow("HTTP request not permitted");
  });
});

// ---------------------------------------------------------------------------
// tractor-bridge
// ---------------------------------------------------------------------------
describe("WasiImports — tractor-bridge", () => {
  it("store-node: calls storeNode callback and returns 'ok'", async () => {
    const { imports, storeNode } = makeImports("strict");
    const result = await imports["refarm:plugin/tractor-bridge"]!["store-node"]!('{"@id":"urn:x:1"}');
    expect(storeNode).toHaveBeenCalledWith('{"@id":"urn:x:1"}');
    expect(result).toBe("ok");
  });

  it("store-node: no storeNode defined → skips and returns 'ok'", async () => {
    const emit = vi.fn();
    const logger = { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() };
    const manifest = createMockManifest();
    const wasi = new WasiImports("p", logger, emit); // no storeNode
    const imports = wasi.generate(manifest, "strict") as unknown as TestImports;

    const result = await imports["refarm:plugin/tractor-bridge"]!["store-node"]!("{}");
    expect(result).toBe("ok");
  });

  it("request-permission: always returns true", async () => {
    const { imports } = makeImports("strict");
    const ok = await imports["refarm:plugin/tractor-bridge"]!["request-permission"]!(
      "read:storage",
      "needs data",
    );
    expect(ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// WASI logging
// ---------------------------------------------------------------------------
describe("WasiImports — wasi:logging", () => {
  it("strict profile: calls logger.debug AND emits plugin:log", () => {
    const { imports, emit, logger } = makeImports("strict");
    imports["wasi:logging/logging"]!.log!("info", "ctx", "hello");

    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("hello"));
    expect(emit).toHaveBeenCalledWith({
      event: "plugin:log",
      pluginId: "test-plugin",
      payload: { level: "info", message: "hello" },
    });
  });

  it("trusted-fast profile: skips logger.debug but still emits plugin:log", () => {
    const { imports, emit, logger } = makeImports("trusted-fast");
    imports["wasi:logging/logging"]!.log!("warn", "ctx", "fast message");

    expect(logger.debug).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith({
      event: "plugin:log",
      pluginId: "test-plugin",
      payload: { level: "warn", message: "fast message" },
    });
  });

  it("versioned alias wasi:logging/logging@0.1.0-draft also works", () => {
    const { imports, emit } = makeImports("strict");
    imports["wasi:logging/logging@0.1.0-draft"]!.log!("debug", "", "versioned");
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ event: "plugin:log", payload: expect.objectContaining({ message: "versioned" }) }),
    );
  });
});

// ---------------------------------------------------------------------------
// WASI environment stubs
// ---------------------------------------------------------------------------
describe("WasiImports — wasi:cli/environment stubs", () => {
  it("getEnvironment returns empty array", () => {
    const { imports } = makeImports("strict");
    expect(imports["wasi:cli/environment"]!.getEnvironment!()).toEqual([]);
  });

  it("getArguments returns empty array", () => {
    const { imports } = makeImports("strict");
    expect(imports["wasi:cli/environment"]!.getArguments!()).toEqual([]);
  });

  it("initialDirectory returns undefined", () => {
    const { imports } = makeImports("strict");
    expect(imports["wasi:cli/environment"]!.initialDirectory!()).toBeUndefined();
  });

  it("versioned key wasi:cli/environment@0.2.0 is also present", () => {
    const { imports } = makeImports("strict");
    expect(imports["wasi:cli/environment@0.2.0"]).toBeDefined();
    expect(imports["wasi:cli/environment@0.2.3"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// WASI streams stubs
// ---------------------------------------------------------------------------
describe("WasiImports — wasi:io/streams stubs", () => {
  it("read() returns [empty Uint8Array, true]", async () => {
    const { imports } = makeImports("strict");
    const streams = imports["wasi:io/streams"]!;
    const [bytes, done] = await streams.read!() as unknown as [Uint8Array, boolean];
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(0);
    expect(done).toBe(true);
  });

  it("write() returns 0n", async () => {
    const { imports } = makeImports("strict");
    expect(await imports["wasi:io/streams"]!.write!()).toBe(0n);
  });

  it("blockingRead() returns [empty Uint8Array, true]", async () => {
    const { imports } = makeImports("strict");
    const [bytes, done] = await imports["wasi:io/streams"]!.blockingRead!() as unknown as [Uint8Array, boolean];
    expect(bytes.length).toBe(0);
    expect(done).toBe(true);
  });

  it("blockingWrite() returns 0n", async () => {
    const { imports } = makeImports("strict");
    expect(await imports["wasi:io/streams"]!.blockingWrite!()).toBe(0n);
  });

  it("subscribe() returns 0n", () => {
    const { imports } = makeImports("strict");
    expect(imports["wasi:io/streams"]!.subscribe!()).toBe(0n);
  });

  it("drop() is callable without throwing", () => {
    const { imports } = makeImports("strict");
    expect(() => imports["wasi:io/streams"]!.drop!()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// WASI clocks
// ---------------------------------------------------------------------------
describe("WasiImports — wasi:clocks/wall-clock", () => {
  it("now() returns an object with a bigint seconds field", () => {
    const { imports } = makeImports("strict");
    const { seconds } = imports["wasi:clocks/wall-clock"]!.now!() as { seconds: bigint; nanoseconds: number };
    expect(typeof seconds).toBe("bigint");
    expect(seconds).toBeGreaterThan(0n);
  });

  it("resolution() returns { seconds: 1n, nanoseconds: 0 }", () => {
    const { imports } = makeImports("strict");
    const res = imports["wasi:clocks/wall-clock"]!.resolution!();
    expect(res).toEqual({ seconds: 1n, nanoseconds: 0 });
  });
});

// ---------------------------------------------------------------------------
// WASI random
// ---------------------------------------------------------------------------
describe("WasiImports — wasi:random/random", () => {
  it("getRandomBytes(n) returns Uint8Array of length n", () => {
    const { imports } = makeImports("strict");
    const bytes = imports["wasi:random/random"]!.getRandomBytes!(8n) as Uint8Array;
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(8);
  });

  it("getRandomU64() returns 0n", () => {
    const { imports } = makeImports("strict");
    expect(imports["wasi:random/random"]!.getRandomU64!()).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// Versioned WASI keys (spot-check)
// ---------------------------------------------------------------------------
describe("WasiImports — versioned WASI keys", () => {
  it("generates @0.2.0 and @0.2.3 variants for wasi:clocks/wall-clock", () => {
    const { imports } = makeImports("strict");
    expect(imports["wasi:clocks/wall-clock@0.2.0"]).toBeDefined();
    expect(imports["wasi:clocks/wall-clock@0.2.3"]).toBeDefined();
  });

  it("generates @0.2.0 variant for wasi:random/random", () => {
    const { imports } = makeImports("strict");
    expect(imports["wasi:random/random@0.2.0"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Drift prevention: every refarm:plugin/* import in the transpiled pi-agent
// artifact must have a matching key registered by WasiImports.generate().
// If this test fails after a WIT rename, regenerate .jco-dist:
//   cargo component build --release --target wasm32-wasip1  (in packages/pi-agent)
//   npx jco transpile <wasm> --name _refarm_pi_agent --out-dir .jco-dist/@refarm/pi-agent --no-nodejs-compat --import-bindings hybrid
// ---------------------------------------------------------------------------
describe("WasiImports — drift prevention: .jco-dist matches registered imports", () => {
  it("every refarm:plugin/* import in _refarm_pi_agent.js has a host registration", () => {
    const require = createRequire(import.meta.url);
    const piAgentDir = dirname(require.resolve("@refarm.dev/pi-agent/package.json"));
    const js = readFileSync(resolve(piAgentDir, "dist/jco/_refarm_pi_agent.js"), "utf-8");

    // Extract all unique 'refarm:plugin/X' strings from import statements.
    const imported = new Set<string>();
    for (const m of js.matchAll(/from\s+'(refarm:plugin\/[^']+)'/g)) {
      imported.add(m[1]!.replace(/@[\d.]+$/, "")); // strip version suffix
    }

    const emit = vi.fn();
    const logger = { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() };
    const wasi = new WasiImports("drift-check", logger, emit);
    const generated = wasi.generate(createMockManifest(), "strict") as Record<string, unknown>;

    for (const key of imported) {
      expect(generated, `Host is missing registration for '${key}' — WIT was renamed but wasi-imports.ts was not updated`).toHaveProperty(key);
    }
  });
});

// ---------------------------------------------------------------------------
// Model bridge behavior (mock opt-in + fail-closed credentials)
// ---------------------------------------------------------------------------
describe("WasiImports — refarm:plugin/model-bridge", () => {
  beforeEach(() => {
    delete process.env.REFARM_MOCK_MODEL_BODY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  it("fails closed when non-ollama provider has no credentials", () => {
    const { imports } = makeImports("strict");
    const modelBridge = imports["refarm:plugin/model-bridge"]!;

    expect(() =>
      modelBridge["complete-http"]!(
        "openai",
        "https://api.openai.com",
        "/v1/chat/completions",
        [["content-type", "application/json"]],
        new Uint8Array([123]),
      ),
    ).toThrow(/No credentials configured for provider "openai"/i);
  });

  it("uses explicit REFARM_MOCK_MODEL_BODY when provided", () => {
    process.env.REFARM_MOCK_MODEL_BODY = JSON.stringify({
      id: "t1",
      choices: [{ message: { role: "assistant", content: "mocked from env" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

    const { imports } = makeImports("strict");
    const modelBridge = imports["refarm:plugin/model-bridge"]!;

    const bytes = modelBridge["complete-http"]!(
      "openai",
      "https://api.openai.com",
      "/v1/chat/completions",
      [["content-type", "application/json"]],
      new Uint8Array([123]),
    ) as Uint8Array;

    const parsed = JSON.parse(Buffer.from(bytes).toString("utf-8"));
    expect(parsed.choices[0]!.message.content).toBe("mocked from env");
  });
});
