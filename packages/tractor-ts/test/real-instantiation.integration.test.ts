import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Tractor } from "../src/index";
import { createMockConfig } from "./helpers/mock-adapters";
// @ts-ignore
import * as heartwoodFixture from "./fixtures/heartwood-transpiled/heartwood.js";

// Mock heartwood to avoid WASM initialization issues in this test
vi.mock("@refarm.dev/heartwood", () => ({
  verify: vi.fn().mockReturnValue(true),
}));

describe("Real WASM Instantiation Integration", () => {
  const wasmPath = process.env.CARGO_TARGET_DIR
    ? path.resolve(
        process.env.CARGO_TARGET_DIR,
        "wasm32-wasip1/release/refarm_heartwood.wasm",
      )
    : path.resolve(
        __dirname,
        "../../heartwood/target/wasm32-wasip1/release/refarm_heartwood.wasm"
      );
  
  const fixtureWasmDir = path.resolve(__dirname, "./fixtures/heartwood-transpiled");

  beforeAll(() => {
    if (!fs.existsSync(wasmPath)) {
      throw new Error(`WASM plugin not found at ${wasmPath}. Build it first!`);
    }
  });

  it("should load, instantiate and call a real WASM component (Heartwood Fixture)", async () => {
    const config = createMockConfig();
    const tractor = await Tractor.boot(config);
    
    // We mock the loader to return our pre-transpiled instance
    // but we use the Tractor dispatch logic
    const manifest = {
      id: "heartwood-fixture",
      name: "Heartwood Fixture",
      version: "0.1.0",
      entry: "file://" + wasmPath,
      capabilities: { provides: [], requires: [] },
      targets: ["server"],
      observability: { hooks: [] },
      certification: { license: "MIT", a11yLevel: 0, languages: ["en"] }
    } as any;

    await tractor.registry.register(manifest);
    const entry = tractor.registry.getPlugin("heartwood-fixture");
    // Standard imports for WASI
    const imports = (tractor.plugins as any).getWasiImports(manifest, "strict");

    // Instantiate with fixture logic
    const componentInstance = await heartwoodFixture.instantiate((name: string) => {
        const baseName = name.endsWith(".wasm") ? name.slice(0, -5) : name;
        const p = path.join(fixtureWasmDir, `${baseName}.wasm`);
        if (!fs.existsSync(p)) {
             throw new Error(`[test] Core module not found: ${p} (requested: ${name})`);
        }
        const buffer = fs.readFileSync(p);
        return new WebAssembly.Module(buffer);
    }, imports);

    expect(componentInstance).toBeDefined();
    
    // Call generateKeypair on real heartwood
    const result = await componentInstance.generateKeypair();
    
    expect(result).not.toBeNull();
    expect(result.publicKey).toBeDefined();
    expect(result.secretKey).toBeDefined();

    await tractor.shutdown();
  }, 30000);
});
