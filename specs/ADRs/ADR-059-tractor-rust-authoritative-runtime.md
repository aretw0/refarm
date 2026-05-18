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

As of 2026-05-18, `@refarm.dev/tractor` consumers fall into these groups:

| Consumer | Current use | Migration pressure |
|---|---|---|
| `apps/farmhand` | Boots `Tractor` and executes tasks through `plugins`/`storeNode`. | High: farmhand should delegate runtime execution to Rust tractor. |
| `packages/homestead` | SDK/runtime shell, stream observers, plugin handles, browser-facing types. | Medium: keep browser/compat boundary; avoid native runtime ownership. |
| `apps/me` | Type-only plugin instance/runtime surfaces via Homestead. | Low: browser/client compatibility surface. |
| `apps/dev` | Type-only plugin instance surfaces plus stream demo seeding. | Low/Medium: browser/client compatibility, but demo seeding should remain thin. |
| `packages/sower` | Plugin class depends on `Tractor` and `SovereignNode`. | Medium: define a narrow host interface instead of depending on full tractor-ts. |
| `packages/scarecrow` | Plugin class and tests depend on `Tractor`/test utils. | Medium: define a narrow host interface and test fixture contract. |
| `packages/plugin-courier` | Type dependency plus integration tests boot `Tractor`. | Medium/High: tests should move toward Rust-backed or narrow host fixtures. |
| `packages/vtconfig` and `packages/toolbox` | Alias/resolution support for `@refarm.dev/tractor` and test utils. | Low: tooling support remains while npm compatibility exists. |
| `templates/courier/typescript` | Template dependency for generated plugins. | Medium: template should eventually depend on a narrow host contract. |

Unused direct dependencies on `@refarm.dev/tractor` were removed from
`packages/barn` and `packages/plugin-tem`; neither imported the package.
`apps/refarm status` no longer boots tractor-ts for a synthetic status payload;
it now builds the local CLI status snapshot directly.

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
