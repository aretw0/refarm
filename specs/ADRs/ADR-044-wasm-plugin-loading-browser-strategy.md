# ADR-044: WASM Plugin Loading — Browser Strategy

**Status**: Accepted
**Date**: 2026-03-16
**Deciders**: Refarm Core Team
**Related**: [ADR-002](ADR-002-offline-first-architecture.md), [ADR-017](ADR-017-studio-micro-kernel-and-plugin-boundary.md), [WASM & JCO Architecture](../../docs/WASM_JCO_ARCHITECTURE.md)

---

## Context

`@refarm.dev/tractor` is the sovereign micro-kernel (ADR-017) that must run in Node.js, browsers, and edge runtimes (ADR-002: offline-first). However, `packages/tractor/src/lib/plugin-host.ts` imports `node:fs/promises`, `node:path`, and `@bytecodealliance/jco` at the module level. These are server-only APIs used to transpile WASM components to JS at runtime and write the result to disk.

**Current situation:**

- When `apps/me` (Astro/Vite) imports `@refarm.dev/tractor`, Vite fails to bundle the package for browser because it cannot externalize `node:fs/promises`, `node:path`, and `@bytecodealliance/jco`.
- The root cause is runtime JCO transpilation: `plugin-host.ts` calls `jco.transpile()`, writes files to `.jco-dist/`, and dynamically imports the output — all at plugin load time.
- This pattern is correct for Node.js but fundamentally incompatible with browser environments (no filesystem access).

**Constraints:**

- ADR-002 mandates that Tractor operates offline-first in the browser.
- ADR-017 establishes the micro-kernel boundary: `PluginHost` is part of the core.
- We cannot remove JCO — it is the canonical transpilation tool for the Wasm Component Model.
- Tractor's other modules (graph-normalizer, telemetry, identity, l8n, secrets) are browser-safe.

---

## Decision

**We will separate plugin transpilation from plugin use.**

JCO transpilation is moved from **plugin load time (runtime)** to **plugin install time**, with the transpiled output stored in OPFS (Origin Private File System). In the browser, plugins are loaded via `dynamic import()` from the OPFS cache, not via runtime JCO.

To express this separation at the package boundary, we introduce a `browser` export condition in `@refarm.dev/tractor`:

```json
"exports": {
  ".": {
    "node": "./dist/index.js",
    "browser": "./dist/index.browser.js",
    "import": "./dist/index.js",
    "types": "./dist/index.d.ts"
  }
}
```

`index.browser.js` is the output of `src/index.browser.ts`, which:

1. Re-exports all browser-safe Tractor modules (graph-normalizer, identity-recovery-host, l8n-host, secret-host, telemetry, types).
2. Exports a **stub `PluginHost`** that: boots without error (allowing `Tractor` to initialize), and throws a descriptive error if `load()` is called without a pre-installed WASM cache.

The stub error message: *"Plugin loading requires the Node.js runtime or a pre-installed WASM cache. Use installPlugin() to cache the transpiled module to OPFS first. See ADR-044."*

---

## Alternatives Considered

### Option 1: Dynamic `import()` with environment detection at runtime
Lazy-load `jco` and `node:fs` only when in Node.js by checking `typeof process !== 'undefined'`. Let the browser code path skip transpilation.

**Pros:**
- Single entrypoint, no export conditions needed.

**Cons:**
- Vite still tries to bundle the dynamic `import('node:fs')` for browser and warns/errors.
- Requires bundler-specific `ssr.noExternal` or `resolve.alias` workarounds in every consumer.
- Not idiomatic — export conditions are the standard mechanism for this.

### Option 2: Vite externalize via `ssr.noExternal` / `optimizeDeps.exclude`
Configure `apps/me` (Astro/Vite) to exclude `@refarm.dev/tractor` from browser bundling.

**Pros:**
- No changes to `tractor` package.

**Cons:**
- Consumer-side workaround that leaks implementation details.
- Breaks if another consumer forgets the config.
- Does not solve the architectural problem (runtime JCO in browser).

### Option 3: Move JCO transpilation to a Web Worker
Run `jco.transpile()` inside a dedicated Web Worker with OPFS write access.

**Pros:**
- Enables runtime transpilation in the browser.
- Non-blocking for the main thread.

**Cons:**
- Web Workers with OPFS writes have limited browser support and complex lifecycle.
- `@bytecodealliance/jco` is not guaranteed to run in a Worker context.
- Significantly higher complexity; premature for the current phase.

### Chosen: Option — Browser export condition + install-time transpilation (this ADR)

**Rationale**: Export conditions are the idiomatic, bundler-agnostic way to provide environment-specific entrypoints. The stub approach is the *honest stabilization*: it doesn't pretend browser plugin loading works without a cache, but it also doesn't break the build or prevent Tractor's other capabilities from working in the browser. The OPFS install-time path is architecturally aligned with ADR-002 (offline-first: cache everything locally before use).

---

## Consequences

**Positive:**

- Vite build for `apps/me` succeeds without configuration changes.
- `@refarm.dev/tractor` can be imported in any browser context; non-plugin APIs work normally.
- The architecture is honest: browser consumers know at compile time (TypeScript) and at runtime (descriptive error) that plugin loading requires prior installation.
- Plugin developers can implement `installPlugin()` using the OPFS strategy without changes to the core.

**Negative:**

- `Tractor` class is not exported from `index.browser.ts` (it depends on `PluginHost` which imports `plugin-host.ts`). Browser consumers who need the full `Tractor` orchestrator must use it in an SSR/Node.js context.
- The install-time transpilation path (`installPlugin()`) is not yet implemented; the stub makes this gap explicit.

**Risks:**

- Browser consumers who call `tractor.plugins.load()` will get a runtime error. (Mitigation: error message is descriptive and points to this ADR.)
- The `browser` export condition requires Vite ≥ 2.9 or webpack with `browserField: true`. (Mitigation: these are baseline requirements for any modern browser build tool.)

---

## Implementation

**Affected components:**

- `packages/tractor/src/index.browser.ts` — browser entrypoint with stub `PluginHost`
- `packages/tractor/package.json` — `exports` field with `node`/`browser` conditions
- `docs/WASM_JCO_ARCHITECTURE.md` — updated transpilation flow and runtime/build-time table
- `docs/KNOWN_LIMITATIONS.md` — new entry for browser plugin loading

**Migration path:**

1. ✅ Add `src/index.browser.ts` (stub entrypoint)
2. ✅ Update `package.json` exports with `browser` condition
3. 🔲 Implement `installPlugin(manifest, wasmUrl)` → fetches WASM, calls JCO in Node.js or a service worker, stores result in OPFS
4. 🟡 Update `PluginHost` browser path to consume OPFS cache at load time
   - ✅ `tractor-ts` now attempts cache-backed `.wasm` load in browser (`WebAssembly.instantiate` over installed artifact)
   - 🔲 remaining: finalize canonical transpile/runtime contract for Component Model artifacts (JCO-compatible browser runner)

**Timeline**: Steps 1–2 are delivered in this ADR. Steps 3–4 are future work, tracked when OPFS integration is scheduled.

---

## References

- [ADR-002: Offline-First Architecture](ADR-002-offline-first-architecture.md)
- [ADR-017: Studio Micro-Kernel and Plugin Boundary](ADR-017-studio-micro-kernel-and-plugin-boundary.md)
- [ADR-009: OPFS Persistence Strategy](ADR-009-opfs-persistence-strategy.md)
- [WASM & JCO Architecture](../../docs/WASM_JCO_ARCHITECTURE.md)
- [JCO — Bytecode Alliance](https://github.com/bytecodealliance/jco)
- [WHATWG: Origin Private File System](https://fs.spec.whatwg.org/#origin-private-file-system)
