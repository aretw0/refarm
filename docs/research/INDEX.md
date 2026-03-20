# Research Archive Index

**Technical Research for Refarm — Foundation & Validations**

This folder serves as a reference library for the research that informed Refarm's architecture. Decisions have been codified into [Architectural Decision Records (ADRs)](../../specs/ADRs/).

---

## Core Architectural Foundations

| Layer | Primary Decision | Related ADR |
|-------|------------------|-------------|
| **Pluggable Storage** | Multi-engine support (SQLite, PGLite, cr-sqlite) | [ADR-029](../../specs/ADRs/ADR-029-pluggable-relational-storage.md) |
| **Microkernel** | WASI-compatible sandboxed plugins | [ADR-025](../../specs/ADRs/ADR-025-pure-microkernel-architecture.md) |
| **Sync Engine** | Field-level CRDT with HLC Convergence | [ADR-028](../../specs/ADRs/ADR-028-crdt-sqlite-convergence-strategy.md) |
| **Storage Pattern** | Triple-based Op-Log with Materializer | [ADR-028](../../specs/ADRs/ADR-028-crdt-sqlite-convergence-strategy.md) |
| **Graph Versioning** | Git-like Commit/Branch/Revert for Data | [ADR-020](../../specs/ADRs/ADR-020-sovereign-graph-versioning.md) |
| **Self-Healing** | Checksum validation & Plugin Citizenship | [ADR-021](../../specs/ADRs/ADR-021-self-healing-and-plugin-citizenship.md) |

---

## Specialized Research Files

### Plugin Runtime & Sandboxing

#### [WASM & Plugin Runtime](./wasm-validation.md)
**Date**: 2026-03-06

Testing procedures for WASM-based plugins in the browser.
Validates WASM Component Model + WIT capability enforcement (toolchain, lifecycle, and capability isolation).

**ADR**: [ADR-025](../../specs/ADRs/ADR-025-pure-microkernel-architecture.md) — WASI-compatible sandboxed plugin runtime.

---

#### [Plugin Ecosystem Lessons](./PLUGIN_ECOSYSTEM_LESSONS.md)

Systematic study of plugin ecosystems (WordPress, VSCode, Minecraft, Jenkins, Obsidian, npm, Electron, Jupyter) that made irreversible architectural mistakes.
Synthesizes what Refarm must do differently to prevent plugin-induced technical debt and security failures.

**ADR**: No ADR yet — feeds plugin manifest contract design and capability enforcement in ADR-025.

---

### Collaborative Editing & Concurrency

#### [Lock Strategies Comparison](./LOCK_STRATEGIES_COMPARISON.md)

Cross-system comparison of collaborative lock models (Google Docs, Notion, Figma, Git, Linear, Confluence, Obsidian) to validate ADR-024's design.
Confirms that Refarm's optional private-branch model with configurable expiry covers all four locking patterns while preserving full offline support.

**ADR**: [ADR-024](../../specs/ADRs/ADR-024-sovereign-graph-versioning.md) — Sovereign graph versioning with private branch checkout.

---

### Graph Architecture & Publishing

#### [Isomorphic Tractor Insight](./isomorphic-tractor-insight.md)

Analysis of running the same Tractor orchestration code on both server (Edge Workers, Node.js, Deno) and client (browser OPFS+SQLite) in Astro Hybrid mode.
Validates that the pure/agnostic Tractor microkernel enables SSR-first rendering with seamless CRDT hydration on the client, with SQL-dialect and plugin-discovery concerns fully resolved.

**ADR**: [ADR-026](../../specs/ADRs/ADR-026-externalized-storage-migrations.md) — Externalized storage migrations; [ADR-025](../../specs/ADRs/ADR-025-pure-microkernel-architecture.md) — Pure microkernel.

---

#### [Graph-Native Publishing](./graph-native-publishing.md)
**Date**: 2026-03-08

Specification for serving Refarm's own public interfaces (landing page, user blogs) as nodes in the Sovereign Graph via the `@refarm.dev/plugin-antenna` HTTP gateway plugin.
Establishes "Graph as Code" philosophy: the shell contains only the WASM host and Tractor; all UI, routing, and content are synchronized as JSON-LD nodes and rendered on demand.

**ADR**: No ADR yet — feeds the `plugin-antenna` specification and sovereign web publishing roadmap.

---

#### [TEM Sovereign Graph Design](./tem-sovereign-graph-design.md)
**Date**: 2026-03-17 | **Status**: Approved

Adapts the Tolman-Eichenbaum Machine (TEM, Whittington et al. 2020) as an in-browser WASM/WebWorker reasoning engine for the Sovereign Graph, capable of learning relational topology, predicting resource co-occurrence, and detecting novelty without backpropagation.
Simultaneously extends the plugin manifest architecture to formally support arbitrary execution contexts (main thread, WebWorker, ServiceWorker, edge runtime).

**ADR**: No ADR yet — feeds the TEM plugin specification and plugin execution-context extension.

---

### Frontend & Design System

#### [Design System Bootstrap Discussion](./design-system-bootstrap-discussion.md)
**Date**: 2026-03-07

Analysis of when and how to bootstrap a headless design system for both internal use (`apps/homestead`) and external plugin integrators, covering headless primitives, accessibility contracts, i18n infrastructure, and semantic tokens.
Concludes that bootstrap should be triggered by objective adoption signals to avoid premature cost, and must treat the design system as infrastructure rather than a visual layer.

**ADR**: No ADR yet — feeds headless UI library and plugin UI contract design.

---

### Browser Strategy & Integrations

#### [Browser Strategy](./browser-extension-discussion.md)
**Date**: 2026-03-06

Analysis of PWA vs. Native Browser Extensions as the primary delivery target for Refarm.
Decision: PWA-first for v0.1.0; native browser extensions deferred to v0.7.0+ to avoid early API surface lock-in.

**ADR**: No ADR yet — feeds the browser delivery roadmap.

---

#### [Toeverything (AFFiNE) Synergies](./toeverything-synergies.md)

Analysis of Toeverything's ecosystem (AFFiNE, OctoBase, BlockSuite) for decoupled integration opportunities.
Identifies pure-Rust/WASM utilities for `tractor` plugins, BlockSuite as a potential frontend editor, and OctoBase CRDT sync as a compatible collaboration layer.

**ADR**: No ADR yet — feeds `tractor` plugin sourcing and CRDT sync strategy.

---

### Security & Identity Protocols

#### [OPAQUE aPAKE Strategic Assessment](./opaque-apake-strategic-assessment.md)
**Date**: 2026-03-20 | **Status**: Research

Strategic analysis of the OPAQUE aPAKE protocol (RFC 9497 / draft-irtf-cfrg-opaque)
and its fit across the Refarm ecosystem. Maps relevance to each area: Recovery Service
(ADR-032), refarm.social, Silo master-key protection, and Cloudflare Workers relay (ADR-037).
Includes a conceptual `identity-contract-v2` WIT sketch for `derive-from-session` —
the WASM capability-boundary encoding of OPAQUE's zero-knowledge guarantee.

**ADR**: No ADR yet — informs `identity-contract-v2` design (v0.2.0) and recovery
plugin authentication strategy (v0.3.0).

---

### Foundational Validations

#### [Critical Validations](./critical-validations.md)

Benchmarks and feasibility studies for Phase 1 browser-native capabilities.
Confirmed: WebLLM in Workers, 100 GB+ OPFS quotas, and Yjs performance vs Automerge.

**ADR**: Referenced across multiple ADRs as empirical baseline for browser-first feasibility.

---

> Note: `competitive-analysis.md` is referenced in older index versions but the file does not exist in this directory. If the file is recovered or re-created, add an entry in the "Competitive Landscape" topic area.

---

## Maintenance

Research files are kept for historical context. For the current technical specification, always refer to the **Architecture** docs and **ADRs**.

**Last Updated**: March 2026
