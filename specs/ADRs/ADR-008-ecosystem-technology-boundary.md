# ADR-008: Ecosystem Technology Boundary (Go vs TypeScript)

**Status**: Accepted  
**Date**: 2026-03-05  
**Deciders**: Core Team  
**Related**: [ADR-007 (Observability)](ADR-007-observability-primitives.md), [lifecycle ecosystem](https://github.com/aretw0/lifecycle/blob/main/docs/ecosystem/refarm.md)

---

## Context

Refarm exists alongside a mature Go ecosystem: **lifecycle** (signal handling, graceful shutdown), **procio** (process hygiene), **trellis** (state machine engine), **introspection** (visualization), and **loam** (data parsing). These projects share the same maintainer and follow the "Serve Sozinho → Converge Emergentemente" pattern.

**Current situation:**

- Refarm is a **TypeScript/JavaScript monorepo** (Turborepo, Astro, WASM plugins)
- Refarm's Kernel runs **in the browser** (offline-first, SQLite via OPFS)
- The Go ecosystem runs **on the OS** (signals, processes, terminal I/O)
- There is conceptual overlap: both ecosystems deal with plugin orchestration, state machines, observability, and lifecycle management
- The Go primitives (e.g. trellis engine, introspection diagrams) are well-tested and architecturally mature

**The question:** Should Refarm reuse Go code (compiled to WASM), rewrite equivalent logic in TypeScript, or adopt a hybrid approach?

---

## Decision

**We will adopt a "Concept Export, Not Code Export" strategy with a clear technology boundary.**

### Browser Domain → TypeScript/JavaScript

All code that runs in the browser (Kernel, Studio, plugins, storage, sync) remains native TS/JS.

### OS Domain → Go (lifecycle + procio)

Any future component that needs access to the local operating system (file indexing, native process management, system signals) will be built in Go using the lifecycle/procio foundation.

### Concept Transfer → Architecture, Not Binaries

The conceptual models proven in Go (DAG execution from trellis, state machine patterns, observability primitives from introspection) will inform the design of TS equivalents — but will **not** be compiled to WASM for browser execution.

---

## Alternatives Considered

### Option 1: Compile Go to WASM for Browser

**Pros:**

- Reuse battle-tested Go code directly
- Single source of truth for orchestration logic
- WASM sandbox aligns with Refarm's plugin model

**Cons:**

- Go WASM binaries are **heavy** (~5-15MB minimum due to Go runtime + GC)
- Poor integration with WASM Component Model / WIT contracts (Go support is immature)
- Goroutine model conflicts with browser's single-threaded Event Loop
- TinyGo reduces size but has significant standard library limitations
- Debugging cross-language boundaries adds cognitive overhead

### Option 2: Full Rewrite in TypeScript

**Pros:**

- Native integration with Astro, Web Workers, OPFS, Web Crypto
- Monorepo cohesion (single toolchain, single CI)
- TS type system provides equivalent safety to Go for domain logic
- Access to rich browser API ecosystem without bridges

**Cons:**

- Loses proven Go implementations (time investment)
- TS lacks Go's concurrency primitives (goroutines, channels)
- No native OS access for future local-first features

### Option 3: Hybrid — TS in Browser, Go as Local Daemon (Chosen)

**Pros:**

- Each technology excels where it matters: TS for browser, Go for OS
- Clear boundary: WASM plugins for browser extensions, Go daemon for native access
- lifecycle/procio provide leak-free, signal-aware local agent for free
- Concept transfer preserves architectural maturity without code coupling
- No heavy WASM binaries in browser

**Cons:**

- Two codebases to maintain for overlapping concepts
- Daemon requires users to install a binary (optional, not required for core)

### Chosen: Option 3 (Hybrid)

**Rationale**: The technology boundary aligns with the domain boundary. Browser and OS are fundamentally different execution environments. Forcing Go into the browser via WASM creates more friction than value. The Go ecosystem's greatest contribution to Refarm is **architectural clarity**, not compiled artifacts.

---

## Consequences

**Positive:**

- Refarm Kernel stays lean: no Go runtime overhead in browser
- Clear separation of concerns: browser vs OS, each with optimal tooling
- Future "Refarm Daemon" (Go) can index local files, integrate with OS-level automation, and expose APIs to browser Kernel via WebSocket or local HTTP
- Monorepo stays cohesive: single language, single toolchain
- Concept transfer is durable: architecture survives language changes

**Negative:**

- Equivalent TS implementations needed for patterns already proven in Go (engine, state machines, observability)
- Two mental models for contributors working across both ecosystems

**Risks:**

- Concept drift: TS implementation may diverge from Go patterns over time (mitigation: shared documentation in both repos, cross-referencing ADRs)
- Daemon complexity: adding a Go binary increases deployment surface (mitigation: daemon is strictly optional, browser-only mode is always complete)

---

## Implementation

**Affected components:**

- `apps/kernel` — Will implement orchestration patterns inspired by trellis engine, natively in TS
- `packages/*` — Remain pure TS, no WASM-from-Go dependencies
- Future `@refarm/daemon` (Go) — Local agent using lifecycle + procio for OS-level data access

**Concept transfer roadmap:**

1. **Engine patterns** (from trellis): DAG execution, worker state machines → inform `apps/kernel` plugin orchestration design
2. **Observability patterns** (from introspection): State visualization, Mermaid generation → inform `@refarm/sdk` observer primitives (see ADR-007)
3. **Lifecycle patterns** (from lifecycle): Graceful shutdown, signal differentiation → inform future Go daemon architecture
4. **Data patterns** (from loam): Parser composition, reactive stores → inform `packages/storage-sqlite` design

**Timeline**: Ongoing — this is a standing architectural principle, not a one-time migration.

---

## References

- [lifecycle Ecosystem Integration](https://github.com/aretw0/lifecycle/blob/main/docs/ECOSYSTEM_INTEGRATION.md)
- [lifecycle Ecosystem: refarm.md](https://github.com/aretw0/lifecycle/blob/main/docs/ecosystem/refarm.md)
- [Trellis Engine Abstraction](https://github.com/aretw0/lifecycle/blob/main/docs/ecosystem/engine_abstraction.md)
- [Introspection Patterns](https://github.com/aretw0/lifecycle/blob/main/docs/ecosystem/introspection.md)
- [ADR-007: Observability Primitives](ADR-007-observability-primitives.md)
- [Refarm Architecture](../../docs/ARCHITECTURE.md)
