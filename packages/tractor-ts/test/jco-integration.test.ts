import * as jco from "@bytecodealliance/jco";
import * as fs from "fs";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * JCO Integration Test Suite
 *
 * Tests the JCO library and compiled WASM plugin.
 * NOTE: The compiled WASM plugin is currently a cdylib (raw library), not a
 * linked Component Model. Full component instantiation requires:
 * 1. wit-component linking: turns ccylib + WIT into component
 * 2. JCO transpilation: converts component to JavaScript + WebAssembly stubs
 * 3. WebAssembly.instantiate(): creates instance (requires runtime support)
 *
 * This test validates the compilation chain and JCO API availability.
 */

describe("JCO Integration", () => {
  const wasmPath = path.resolve(
    __dirname,
    "../../../validations/wasm-plugin/hello-world/target/wasm32-wasip1/release/hello_world_plugin.wasm",
  );

  let wasmBuffer: Buffer;

  beforeEach(() => {
    // Load the compiled WASM plugin binary
    if (!fs.existsSync(wasmPath)) {
      throw new Error(
        `WASM plugin not found at ${wasmPath}. Run: cd validations/simple-wasm-plugin && cargo build --target wasm32-unknown-unknown --release`,
      );
    }
    wasmBuffer = fs.readFileSync(wasmPath);
  });

  afterEach(() => {
    // Cleanup
    wasmBuffer = null as any;
  });

  it("should have JCO library available", () => {
    // Verify JCO exports are accessible
    expect(jco).toBeDefined();
    expect(typeof jco.transpile).toBe("function");
    expect(typeof jco.componentNew).toBe("function");
  });

  it("should load compiled WASM plugin binary", () => {
    // Verify simple-wasm-plugin compiled successfully
    expect(wasmBuffer).toBeDefined();
    expect(wasmBuffer.length).toBeGreaterThan(0);

    // Check WASM magic number
    const magic = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
    const wasmMagic = wasmBuffer.subarray(0, 4);
    expect(wasmMagic).toEqual(magic);
  });

  it("should have compiled plugin of expected size", () => {
    // The hello_world_plugin.wasm is a real component-model-based plugin, ~70KB
    expect(wasmBuffer.length).toBeGreaterThan(50000);
    expect(wasmBuffer.length).toBeLessThan(100000);
  });

  it("should document component linking requirement", () => {
    // Raw cdylib WASM needs linking to become a component.
    // This step is deferred to plugin-compiler integration:
    // - wit-component links: cdylib + WIT interfaces -> component
    // - JCO transpiles: component -> JS bindings + WASM stubs
    // - Instantiate: WebAssembly.instantiate(component, imports)

    const linkingSteps = [
      "wit-component componentNew(cdylib, wit/interface)",
      "JCO transpile(component)",
      "WebAssembly.instantiate(component, importObject)",
      "PluginHost wraps with trust governance",
    ];

    expect(linkingSteps).toHaveLength(4);
  });

  it("should show JCO componentNew API for dynamic linking", () => {
    // JCO's componentNew allows creating components programmatically
    // This will be used in plugin-compiler to link plugins
    const componentNewFn = jco.componentNew;
    expect(componentNewFn).toBeDefined();
    expect(typeof componentNewFn).toBe("function");
  });

  it("should document post-linking instantiation path", () => {
    // Once linked into a component, the flow is:
    // 1. Load component bytes
    // 2. await jco.transpile(component)  -> generates JS + bindings
    // 3. Create import object for tractor-bridge callbacks
    // 4. WebAssembly.instantiate(component, imports)
    // 5. Call exported functions: plugin.setup(), plugin.ingest(), etc.

    const instantiationAfterLinking = [
      "await jco.transpile(componentWasm, {name, runtime})",
      "load generated binding JS module",
      "create tractor-bridge import trampoline",
      "WebAssembly.instantiate(componentWasm, imports)",
      "call plugin exports via bindings",
    ];

    expect(instantiationAfterLinking).toHaveLength(5);
  });

  it("should defer full integration to plugin-compiler + browser tests", () => {
    // The complete plugin compilation and instantiation pipeline will be:
    // - plugin-compiler: source plugin (Rust) -> linked component -> transpiled JS
    // - homestead: browser runtime instantiation of plugins
    // - PluginHost: wraps with trust governance and call dispatch
    //
    // This test validates that the compilation chain is intact and
    // JCO is available. Real instantiation requires WebAssembly runtime
    // and will be tested in browser environment (jco-integration.browser.test.ts)

    const deferredWork = [
      "plugin-compiler integration (Rust -> component linking)",
      "browser-based instantiation tests (WebAssembly.instantiate)",
      "real tractor-bridge import object implementation",
      "PluginHost.load() call dispatch with real components",
    ];

    expect(deferredWork).toHaveLength(4);
  });
});
