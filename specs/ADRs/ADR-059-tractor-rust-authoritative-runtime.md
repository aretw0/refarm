# ADR-059 — Tractor Rust as Authoritative Runtime

**Status:** Accepted  
**Date:** 2026-05-04  
**Author:** Arthur Silva  

## Context

Refarm currently has two runtime implementations:

- **tractor** (Rust binary) — original WASM host; loads pi-agent, drives CRDT storage, exposes WebSocket sync on `:42000`. Requires `cargo build --release`. No HTTP sidecar.
- **tractor-ts** (TypeScript) — reimplementation of the same interfaces, used inside **farmhand** (Node.js daemon). Exposes the HTTP sidecar on `:42001` that `refarm ask` relies on.

They implement the same runtime contract independently. Without cross-conformance tests, they diverge silently. The farmhand flow (`refarm ask`) routes through tractor-ts, leaving the Rust binary out of the production cycle and at risk of becoming a neglected artifact.

The goal is for refarm to become a daily driver — always-on, fast, low footprint, with real WASM isolation and extensibility to any language that compiles to WASM. tractor-ts cannot be the authoritative runtime for this goal.

## Decision

**tractor (Rust) is the authoritative runtime.** All production WASM execution flows through the Rust binary. tractor-ts is retained as a conformance harness and development convenience, not as a production runtime.

The farmhand daemon evolves into an **orchestration shell** that delegates WASM execution to the tractor binary via its HTTP sidecar, while retaining responsibility for:
- Plugin discovery (`~/.refarm/plugins/`)
- Task memory (SQLite)
- HTTP sidecar proxying
- Process lifecycle management

`@refarm.dev/tractor` may continue to be published from `packages/tractor-ts`
for npm compatibility, browser-native flows, and existing TypeScript consumers,
but that package is a compatibility boundary, not the source of runtime truth.
New runtime behavior lands in Rust first unless it is explicitly browser-only or
npm-compatibility-only.

Runtime-facing TypeScript consumers should depend on narrow host contracts from
`@refarm.dev/runtime`, not on the full `Tractor` class. These contracts describe
the minimum surface an orchestrator needs (`plugins.get`, `plugins.load`,
`registry`, `storeNode`, `onNode`) and let farmhand, tests, and future Rust
adapters converge without treating tractor-ts as the domain interface.

### TypeScript Boundary

The TypeScript package should shrink toward a browser/compatibility boundary.
Its transitional scaffold is now represented by `hybrid-bindings-package`: it
publishes from `dist/src/*`, emits `src/**/*` plus `test/test-utils.ts`, and
keeps `./test/test-utils` as an explicit test utility export.

Responsibilities that remain natural in TypeScript:

- Browser entrypoint and browser plugin loading policy.
- OPFS plugin cache and browser runtime module cache.
- Browser runtime descriptor install/verification flows.
- Compatibility exports for existing npm consumers.
- Thin test utilities used by TypeScript packages.
- Pure projection helpers consumed directly by UI/client code, if they remain
  dependency-light and runtime-neutral.

Responsibilities that should not grow further in tractor-ts:

- Native plugin host orchestration.
- WASI import surface and bridge behavior.
- Trust policy enforcement for native execution.
- Runtime telemetry bus as source of truth.
- Storage/sync lifecycle and daemon lifecycle.
- Core command/identity boot behavior when used as runtime driver.

Rust already owns the target implementations for these areas in
`packages/tractor`:

- `host/plugin_host/*`
- `host/wasi_bridge/*`
- `trust/mod.rs`
- `storage/sqlite.rs`
- `sync/loro.rs`
- `telemetry/mod.rs`
- `daemon/ws_server.rs`

### Current TypeScript Consumer Map

As of 2026-05-19, `@refarm.dev/tractor` consumers fall into these groups:

| Consumer | Current use | Migration pressure |
|---|---|---|
| `apps/farmhand` | Still boots `Tractor` during transition, but task execution, plugin loading, reload, and sidecar handlers consume `@refarm.dev/runtime` host contracts. | High: next step is replacing the bootstrap with Rust tractor delegation. |
| `packages/homestead` | Browser runtime boot still uses tractor-ts; plugin handles, Studio host UI contracts, shell i18n/log gating, and stream observation projections are Homestead/runtime-owned. | Medium: keep browser/compat boundary; avoid native runtime ownership. |
| `apps/me` | Consumes Homestead runtime and `@refarm.dev/runtime` plugin-handle types; no direct tractor-ts dependency remains. | Low: browser runtime still arrives through Homestead until that boundary is redesigned. |
| `apps/dev` | Consumes Homestead runtime and `@refarm.dev/runtime` plugin-handle/node-store types for diagnostics and stream demos; no direct tractor-ts dependency remains. | Low/Medium: browser runtime still arrives through Homestead, but app fixtures no longer type against tractor-ts. |
| `packages/sower` | Plugin class depends on `@refarm.dev/runtime` host capabilities (`emitTelemetry`, `switchTier`) and runtime node types. | Low/Medium: no direct tractor-ts dependency remains; future work is validating the host contract against Rust tractor. |
| `packages/scarecrow` | Plugin class and tests depend on `@refarm.dev/runtime` host capabilities (`observe`, `queryNodes`, `setPluginState`, `emitTelemetry`). | Low/Medium: no direct tractor-ts dependency remains; future work is validating the host contract against Rust tractor. |
| `packages/plugin-courier` | Production code and integration tests depend on `@refarm.dev/runtime` query capability and a narrow host fixture; no direct tractor-ts dependency remains. | Low/Medium: future work is validating the host contract against Rust tractor. |
| `packages/vtconfig` and `packages/toolbox` | Alias/resolution support for `@refarm.dev/tractor` and test utils. | Low: tooling support remains while npm compatibility exists. |
| `templates/workspace/typescript` | Default public workspace template boots through Homestead runtime and does not declare `@refarm.dev/tractor` directly. | Low/Medium: browser runtime still arrives through Homestead until that boundary is redesigned. |

Unused direct dependencies on `@refarm.dev/tractor` were removed from
`packages/barn` and `packages/plugin-tem`; neither imported the package.
`apps/refarm status` no longer boots tractor-ts for a synthetic status payload;
it now builds the local CLI status snapshot directly.

### Tractor TypeScript Retention Review

The TypeScript package remains necessary as an npm and browser compatibility
boundary, but it should not continue acting as a second native runtime. The
current source tree mixes four categories:

| Category | Current modules | Long-term owner |
|---|---|---|
| Browser-only host surface | `index.browser.ts`, `install-plugin.ts`, `opfs-plugin-cache.ts`, browser runtime descriptor verification/revocation helpers | Keep in TypeScript while browser runtime support exists. |
| UI/client projections | `agent-response-stream.ts`, `stream-chunk.ts`, `stream-session.ts`, `stream-view.ts`, selected telemetry diagnostics helpers | Prefer moving to protocol/contract packages when reused outside Tractor; keep dependency-light reducers available to browser clients. |
| Compatibility host facade | `Tractor.boot`, `CommandHost`, graph normalizer, test utilities, compatibility exports | Keep temporarily for npm compatibility and TS integration tests; shrink toward narrow contracts from `@refarm.dev/runtime`. |
| Native runtime behavior | `plugin-host.ts`, `plugin-runner.ts`, `main-thread-runner.ts`, `worker-runner.ts`, `wasi-imports.ts`, native trust enforcement, native telemetry authority, storage/sync lifecycle | Rust owns this. Do not grow new behavior here except compatibility shims covered by conformance tests. |

The Rust crate already contains the intended homes for native execution:

- plugin loading and Component Model execution: `packages/tractor/src/host/plugin_host/*`
- host imports/WASI bridge: `packages/tractor/src/host/wasi_bridge/*`
- trust policy: `packages/tractor/src/trust/mod.rs`
- storage and CRDT sync: `packages/tractor/src/storage/*`, `packages/tractor/src/sync/*`
- daemon/WebSocket routing: `packages/tractor/src/daemon/*`
- sidecar protocol: `packages/tractor/src/sidecar/*`
- streaming observations: `packages/tractor/src/streaming/*`
- telemetry authority: `packages/tractor/src/telemetry/*`

Practical reduction rule:

1. If code needs Node-native WASM execution, filesystem/runtime process
   management, trust enforcement, or host-import policy, it belongs in Rust.
2. If code needs browser APIs such as OPFS, dynamic ESM loading, or browser
   runtime descriptor installation, it can remain in TypeScript.
3. If code is a pure reducer/projection over persisted protocol nodes, prefer a
   small contract/protocol package over `tractor-ts`.
4. If a TS package only needs `plugins.get/load`, `registry`, `storeNode`,
   `onNode`, or telemetry hooks, it should depend on `@refarm.dev/runtime`
   contracts rather than importing the full `Tractor` class.

Near-term shrink targets:

- Replace `apps/farmhand`'s direct `Tractor.boot` path with Rust sidecar
  delegation once the Rust HTTP protocol covers the same driver flow.
- Extract stream/task/session projection helpers that are not browser-runtime
  specific into explicit contract packages, so UI clients do not import
  `@refarm.dev/tractor` for plain data reduction.
- Keep `@refarm.dev/tractor` npm name as a compatibility facade until consumers
  no longer need the legacy class shape.

## Consequences

### What changes

1. **tractor gains an HTTP sidecar** (`--http-port`, default `:42001`) — the same `/efforts` protocol farmhand exposes today (see ADR-060). This is the unlock that makes `refarm ask` work with tractor directly.

2. **farmhand becomes a thin shell** — when a tractor binary is present, farmhand spawns it as a subprocess and proxies the HTTP sidecar. farmhand retains plugin discovery and task memory.

3. **tractor-ts conformance tests** — the existing `pi_agent_harness.rs` tests become the canonical conformance suite. Equivalent tests are added to tractor-ts to ensure both implementations satisfy the same behavioral contracts.

4. **`npm run agent:daemon` joins the canonical flow** — once tractor has the HTTP sidecar, `agent:daemon` becomes a valid alternative to `farmhand:daemon`. The long-term canonical flow becomes a single command that starts whichever runtime is available.

### What stays the same

- The effort/stream protocol (`POST /efforts`, SSE streams) — defined in ADR-060, unchanged from today.
- The CRDT storage schema — Loro-based, shared between both runtimes.
- Plugin manifest format (`plugin.json`) — unchanged.
- `refarm ask` CLI — continues to hit `:42001`, oblivious to which runtime is behind it.

### Why not tractor-ts as authoritative

| Concern | tractor-ts | tractor Rust |
|---|---|---|
| WASM sandbox | emulated via wasmtime Node bindings | native wasmtime |
| Memory footprint | ~120MB (Node) | ~20MB |
| Cold start | ~800ms | ~50ms |
| Daily driver fitness | marginal | strong |
| Extension surface | npm ecosystem | any WASM target |
| LSP bridge | partial | complete (harness-tested) |

## Implementation Phases

**Phase 1 (immediate):** tractor HTTP sidecar — `--http-port` flag, `/efforts` endpoints, effort-to-plugin dispatch. Tracked in ADR-060.

**Phase 2:** farmhand delegates to tractor binary when present. tractor-ts becomes conformance-only.

**Phase 3:** single canonical boot command; daily driver flow established.

## Related

- ADR-056: Unified Refarm Host Boundary
- ADR-058: Context Injection Doctrine
- ADR-060: Tractor HTTP Sidecar Protocol
