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
