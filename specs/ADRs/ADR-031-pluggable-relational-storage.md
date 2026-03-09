# ADR-031: Pluggable Relational Storage & CRDT Strategies

**Status**: Proposed  
**Date**: 2026-03-09  
**Deciders**: @aretw0, Antigravity  
**Related**: [ADR-003](./ADR-003-crdt-synchronization.md), [ADR-010](./ADR-010-schema-evolution.md), [ADR-015](./ADR-015-sqlite-engine-decision.md), [ADR-028](./ADR-028-crdt-sqlite-convergence-strategy.md)

---

## Context

Refarm aims to be a "Personal Operating System" for sovereign data. A key component is the storage layer, which must handle:

1. **Offline-first persistence**: Storing data safely in the browser (OPFS).
2. **Decentralized Sync**: Merging updates from different devices via CRDT.
3. **Schema Evolution**: Handling changes in plugin data structures without specialized migrations or data loss.

Previously, the focus was primarily on a single SQLite-backed engine with application-level migration lenses (ADR-010) and a field-level LWW CRDT log (ADR-028).

**Current Challenges**:

- **Innovation Velocity**: New technologies like `cr-sqlite` (native SQLite CRDT extension) and `PGLite` (Postgres in WASM) offer powerful alternatives but require different integration strategies.
- **AI/LLM Integration**: Future support for `WebLLM` and `WebGPU` requires efficient vector storage and embedding management, which might be better suited for specific engines (e.g., PGLite for vector extensions).
- **Vendor Lock-in**: Hard-coding the kernel to a specific storage engine limits the ability to pivot or allow developers to choose the best engine for their plugins.

---

## Decision

**We will architect the Refarm Tractor as a Storage-Agnostic Host that supports Pluggable Relational Engines.**

Key aspects of this decision:

1. **Storage Port Abstraction**: Define a standard "Relational Storage Port" (via WIT) that every storage adapter must implement.
2. **Pluggable Strategies**: Support at least three primary strategies for evaluation and production:
    - **Strategy A (Legacy/Lenses)**: Vanilla SQLite + ADR-010 Upcasting Lenses + ADR-028 LWW Log.
    - **Strategy B (Native CRDT)**: `cr-sqlite` (or similar) providing native relational CRDT capabilities at the database level.
    - **Strategy C (Advanced/IA)**: `PGLite` spawns for advanced indexing, vector embeddings (via pgvector-like WASM extensions), and deep search.
3. **Interoperability Layer**: The kernel must ensure that even if different storage engines are used, they can still synchronize using a common CRDT wire format (e.g., the Op-Log defined in ADR-028).
4. **Benchmarking & Comparison**: The tractor will allow swapping these engines in testing environments to compare performance, reliability, and convergence speed.

---

## Alternatives Considered

### Option 1: Double-down on cr-sqlite
**Pros:** Native performance, simpler application logic for CRDT.
**Cons:** Requires specific WASM builds and might not support all browsers or advanced AI indexing needs as well as PGLite.

### Option 2: Stick to Vanilla SQLite + Application Lenses
**Pros:** Maximum compatibility, already partially implemented.
**Cons:** "Mathematical nightmare" of manual reconciliation, harder to optimize for complex graph queries.

### Chosen: Pluggable Multi-Engine Architecture
**Rationale**: Future-proofs the platform for WebGPU/WebLLM integration and allows the project to benefit from the best-in-class storage technologies as they evolve.

---

## Consequences

**Positive:**

- **Sovereignty**: Users can choose where and how their data is stored and indexed.
- **Performance**: Ability to spawn specialized PGLite instances for vector search without polluting the primary metadata storage.
- **Flexibility**: Easier to switch storage backends if a superior technology emerges.

**Negative:**

- **Increased Complexity**: The Tractor Host must manage a more complex lifecycle for pluggable storage adapters.
- **Contract Surface**: The WIT interface for the storage port must be comprehensive enough to cover different DB dialects (or standardize on a subset of SQL).

---

## Implementation

**Affected components:**

- `packages/tractor`: Host orchestrator needs new adapter injection logic.
- `packages/storage-sqlite`: Will be one of several available adapters.
- `packages/storage-pglite`: (New package) For Postgres-backed storage.
- `wit/refarm-sdk.wit`: Update to include the storage port interface.

**Timeline**:

- **v0.5.0**: Abstract the current SQLite adapter into a generic Port.
- **v0.6.0**: Prototype PGLite and cr-sqlite adapters.
- **v1.0.0**: Stable pluggable storage API.

---

## References

- [cr-sqlite](https://github.com/vlcn-io/cr-sqlite)
- [PGLite](https://pglite.dev/)
- [Ink & Switch: Cambria](https://www.inkandswitch.com/cambria/)
- [WebLLM](https://webllm.mlc-ai.org/)
