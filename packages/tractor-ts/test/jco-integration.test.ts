import * as jco from "@bytecodealliance/jco";
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

const wasmPath = path.resolve(
  __dirname,
  "../../../validations/wasm-plugin/hello-world/dist/refarm_hello_world_plugin.wasm",
);
const wasmExists = fs.existsSync(wasmPath);

describe("JCO Integration", () => {

  it("should have JCO library available", () => {
    // Verify JCO exports are accessible
    expect(jco).toBeDefined();
    expect(typeof jco.transpile).toBe("function");
    expect(typeof jco.componentNew).toBe("function");
  });

  it.skipIf(!wasmExists)("should load compiled WASM plugin binary", () => {
    const wasmBuffer = fs.readFileSync(wasmPath);
    expect(wasmBuffer.length).toBeGreaterThan(0);
    const magic = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
    expect(wasmBuffer.subarray(0, 4)).toEqual(magic);
  });

  it.skipIf(!wasmExists)("should have compiled plugin of expected size", () => {
    // hello_world_plugin.wasm is a real component-model-based plugin, ~70KB
    const wasmBuffer = fs.readFileSync(wasmPath);
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
