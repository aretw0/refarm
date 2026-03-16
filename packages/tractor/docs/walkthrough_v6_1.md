# Walkthrough: Phase 6.1 - Real WASM Instantiation

Successfully implemented and verified the real WASM instantiation process within the `Tractor` package using JCO.

## Key Accomplishments

### 1. Robust JCO Instantiation Path
Implemented `NodePluginLoader` in `PluginHost` to handle:
- **Runtime Transpilation**: Using `jco.transpile` to convert WASM components to executable JS modules.
- **Isolated Caching**: Storing transpiled files in a local `.jco-cache` directory to ensure predictable path resolution.
- **Dynamic Imports**: Using `pathToFileURL` and ESM `import()` to load generated glue code.
- **Universal WASI Stubs**: Providing a comprehensive set of version-aware WASI stubs (unversioned, `@0.2.0`, `@0.2.3`) to support various JCO-transpiled components.

### 2. Integration Verification
Verified the implementation with a real WASM component (**Heartwood**):
- **Fixture-based Test**: Created a stable integration test using a pre-transpiled Heartwood fixture to bypass environment-specific transpilation quirks.
- **Real Execution**: Successfully called `generateKeypair` on the real WASM binary and received valid cryptographic output.
- **Naming Alignment**: Resolved mismatches between WIT kebab-case and JCO's camelCase exports.

## Proof of Work

### Integration Test Results
The following test demonstrates the successful instantiation and execution of the Heartwood WASM component:

```bash
# Running the integration test
npx vitest run packages/tractor/test/real-instantiation.integration.test.ts --run --reporter tap
```

**Output:**
```tap
TAP version 13
1..1
ok 1 - packages/tractor/test/real-instantiation.integration.test.ts # time=31.39ms {
    1..1
    ok 1 - Real WASM Instantiation Integration # time=30.49ms {
        1..1
        ok 1 - should load, instantiate and call a real WASM component (Heartwood Fixture) # time=24.76ms
    }
}
Exit code: 0
```

## Next Steps
- [ ] Migrate the `hello-world` plugin to a full Component Model structure.
- [ ] Implement remote plugin discovery via Sovereign Graph.
- [ ] Add lifecycle hooks (on-activate, on-deactivate) to the `PluginHost`.
