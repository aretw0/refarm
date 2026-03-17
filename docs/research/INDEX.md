# Research Archive Index

**Technical Research for Refarm — Foundation & Validations**

This folder serves as a reference library for the research that informed Refarm's architecture. Decisions have been codified into [Architectural Decision Records (ADRs)](../../specs/ADRs/).

---

## 🏛️ Core Architectural Foundations

| Layer | Primary Decision | Related ADR |
|-------|------------------|-------------|
| **Pluggable Storage** | Multi-engine support (SQLite, PGLite, cr-sqlite) | [ADR-029](../../specs/ADRs/ADR-029-pluggable-relational-storage.md) |
| **Microkernel** | WASI-compatible sandboxed plugins | [ADR-025](../../specs/ADRs/ADR-025-pure-microkernel-architecture.md) |
| **Sync Engine** | Field-level CRDT with HLC Convergence | [ADR-028](../../specs/ADRs/ADR-028-crdt-sqlite-convergence-strategy.md) |
| **Storage Pattern** | Triple-based Op-Log with Materializer | [ADR-028](../../specs/ADRs/ADR-028-crdt-sqlite-convergence-strategy.md) |
| **Graph Versioning**| Git-like Commit/Branch/Revert for Data | [ADR-020](../../specs/ADRs/ADR-020-sovereign-graph-versioning.md) |
| **Self-Healing** | Checksum validation & Plugin Citizenship | [ADR-021](../../specs/ADRs/ADR-021-self-healing-and-plugin-citizenship.md) |

---

## 🔍 Specialized Research Files

### [Critical Validations](./critical-validations.md)
Benchmarks and feasibility studies for Phase 1.

- **Confirmed**: WebLLM in Workers, 100GB+ OPFS Quotas, Yjs performance vs Automerge.

### [WASM & Plugin Runtime](./wasm-validation.md)
Testing procedures for WASM-based plugins.

- **Includes**: Toolchain setup (Rust/TinyGo), lifecycle validation, and capability enforcement.

### [Browser Strategy](./browser-extension-discussion.md)
Analysis of PWA vs. Native Extensions.

- **Decision**: PWA-first for v0.1.0; Extensions deferred to v0.7.0+.

### [Competitive Landscape](./competitive-analysis.md)
Refarm's positioning vs Obsidian, Logseq, and Anytype.

- **Focus**: Local-first sovereignty and semantic data portability (JSON-LD).

### [Toeverything (AFFiNE) Synergies](./toeverything-synergies.md)
Analysis of Toeverything's ecosystem for decoupled integration.

- **Focus**: Rust/WASM utilities for `tractor`, BlockSuite for frontend, and OctoBase CRDT sync.

---

## 📅 Maintenance
Research files are kept for historical context. For the current technical specification, always refer to the **Architecture** docs and **ADRs**.

**Last Updated**: March 2026
