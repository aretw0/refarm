# Refarm - Evolutionary Roadmap

**Semantic Versioning**: Major.Minor.Patch  
**Current**: v0.0.1-dev  
**Target Architecture Stability**: v0.1.0 (Sovereign Foundations)

---

## 🛑 Strict Release Policy (Pre v0.1.0)

Refarm is intentionally being held in `< 0.1.x` during this architectural stabilization phase. The project represents a paradigm shift (Sovereignty + WASM + CRDTs), and we must perfect the core "Universal Blocks" before minting `v0.1.0`.

No packages will advance to `v1.0` or even `v0.1` until:
1. All core building blocks (`sync-loro`, `storage-sqlite`, `tractor`, etc) are independently stable and universally composable.
2. The headless daemon (`Farmhand`) and browser execution contexts (`Studio/Homestead`) are fully synchronized.
3. The project is fully structurally migrated to the new `refarm-dev` organization.

Each release follows: **SDD → BDD → TDD → DDD** (see [Workflow Guide](../docs/WORKFLOW.md))

---

## v0.1.0 - Sovereign Foundations

**Milestone**: The culmination of Phase 1 through Phase 6. A stable, offline-first execution engine (`Tractor`) capable of hosting capability-isolated WASM plugins, bidirectionally synchronizing via Loro CRDTs, and orchestrating work across local daemons (`Farmhand`).

**Status**: In Progress (Phase 6 Finalization)

### Phase 1 to Phase 5: Architecture Bootstrapping ✅
*Historical milestones achieved during earlier sprints.*

- ✅ ADR-001/008: Monorepo structure, Turborepo, NPM workspaces.
- ✅ ADR-002/009: Offline-first architecture and OPFS persistence.
- ✅ ADR-015: SQLite Engine abstraction.
- ✅ ADR-025: Pure Microkernel mapping — `Tractor` routing WASI calls agnostically.
- ✅ ADR-036/042: Sovereign Bootloader, Homestead modularization.
- ✅ ADR-037: Infrastructure Escalation Strategy (Mailboxes, Webhooks).

### Phase 6: Sync & Execution Stabilization 🚧 (CURRENT)
*Consolidating the engine's core capabilities (CRDT and Plugin runtime) based on the Snapshot Plan.*

- ✅ **ADR-045: Loro CRDT Adoption**
  - Replaced hand-written CRDT with binary Loro deltas.
  - `LoroCRDTStorage` implementing Storage and Sync contracts via CQRS + SQLite.
- ✅ **ADR-046: Composition Model (Blocks vs Distros)**
  - Decoupled sovereign philosophy from underlying universal blocks.
- 🚧 **ADR-044: WASM Plugin Loading (Browser Strategy)**
  - ✅ Support for pre-transpiled JS bundles (`refarm plugin bundle` -> JCO).
  - 🚧 (WIP) `installPlugin()` OPFS cache and SHA-256 validation.
  - 🔄 (Future) Strategy A: Pure Web Worker JCO transpilation prototype.
- ✅ **Tractor Daemon (graduated ADR-048, 2026-03-19 — replaces `apps/farmhand`)**
  - ✅ Boots headless, connects via WebSocket (`ws://localhost:42000`).
  - ✅ Loro binary transport (JS↔Rust interop confirmed by `loro_binary_js_interop`).
  - 🚧 (WIP) Consumer testing end-to-end with production `.db` (7 consumers validated in isolation; full pairing with Homestead pending — Gate 2/3).
  - 🚧 (WIP) `installPlugin()` OPFS cache and SHA-256 validation (ADR-044) — delegated to **Barn** (`packages/barn`).
  - 🔄 (Future) OS daemon installation via `refarm provision` and LAN mDNS discovery.

### Decision Gate for v0.1.0 Release
To bump to version `0.1.0` and begin publishing to the `@refarm.dev` npm scope, all systems must coordinate:
1. `Tractor` (Browser) successfully loads pre-transpiled loaded WASM components from OPFS.
2. `apps/me` (refarm.me) boots consolidated with tractor: StudioShell active, sovereign plugins loaded from OPFS, Loro sync roundtrip validated, offline-first confirmed.
3. 100% test passing on `storage-sqlite`, `sync-loro`, and `tractor`.
4. Successful migration to the final GitHub/NPM organizational structures.

---

## v0.2.0 - Sovereign Discovery & Graph Integration

**Milestone**: Discoverability and dynamic capability wiring.  
**Target**: Post-v0.1.0

### Implementation Focus

**Identity (first deliverable — can start now, no OPAQUE dependency):**
- [ ] `identity-nostr` WASM adapter — implements `sign/verify/public-key/derive-from-session` from `world refarm-identity-plugin` WIT (commit `07f338b`).
- [ ] Validation plugin in `validations/identity-nostr-plugin/` (Rust, `cargo-component`).

**Discovery & Graph:**
- [ ] Implement remote source resolution (fetching plugins via Sovereign Graph from URLs/IPFS).
- [ ] Connect the `Registry` (identifying plugins in the graph) to `Tractor` (dynamically loading components on demand).
- [ ] Enable Tractor to inject dynamic Sovereign Graph configurations into plugins upon activation.

---

## Future Trajectories (R&D / Uncommitted)

These tracks run parallel to the core version bumps and represent ongoing Research & Development to push the boundaries of the Sovereign Web.

### 🦀 Rust Tractor (`tractor`) ✅ GRADUATED (ADR-048, 2026-03-19)

> Roadmap detalhado: [`packages/tractor/docs/ROADMAP.md`](../packages/tractor/docs/ROADMAP.md)

Porting the `wasmtime`, `tokio`, and `rusqlite` stack to a pure native Rust footprint (`~27MB`).
- **Goal**: Enable direct execution on IoT devices (Raspberry Pi Zeros, Android via Termux) without the heavy JS V8 engine layer.
- **Why**: Eliminates JCO transpilation. Directly consumes standard `.wasm` components.
- **Coordination**: Will share identical SQLite schemas and interface contracts with the TypeScript Tractor, allowing seamless database portability.

**Progress** (Phases 0–9 complete — 52/52 tests — all graduation criteria ✅):
- ✅ Phase 0 — Scaffolding (Cargo.toml, modular structure, session docs)
- ✅ Phase 1 — `NativeStorage` (rusqlite, schema compat with `storage-sqlite`)
- ✅ Phase 2 — `TrustManager` (TrustGrant, ExecutionProfile, SecurityMode)
- ✅ Phase 3 — `TelemetryBus` (broadcast fan-out, RingBuffer, sensitive masking)
- ✅ Phase 4 — Plugin Host (wasmtime `bindgen!`, WIT bindings, 7 bridge fns)
- ✅ Phase 5 — CRDT Sync (loro-rs + CQRS Projector)
- ✅ Phase 6 — WebSocket Daemon (replaces farmhand on port 42000)
- ✅ Phase 7 — Public API + CLI binary (`TractorNative::boot()`, `--plugin`)
- ✅ Phase 8 — Conformance (schema fix, 3 conformance tests, SecurityMode enforcement)
- ✅ Phase 9 — Final docs (ARCHITECTURE.md, ADR-047, consumer map)
- ✅ Criterion #2 — Loro binary interop JS↔Rust: fixture from `loro-crdt` JS imported by `loro` Rust (`loro_binary_js_interop`)
- ✅ Criterion #3 — Plugin lifecycle (setup/ingest/teardown) conformance tests added
- ✅ Criterion #5 — Binary footprint ≤30 MB: measured 27 MB; target redefined (ADR-047 errata)

**All 6 graduation criteria satisfied.** Migration plan in `specs/ADRs/ADR-048-tractor-graduation.md`.

#### Core Infrastructure Plugins (Groundwork)

The following core plugins provide the infrastructure for development and management within the Refarm ecosystem:

| Plugin | Purpose | Status |
|--------|---------|--------|
| **Barn (O Celeiro)** | Machinery Manager (Plugin lifecycle, OPFS cache, SHA-256) | 🚧 In Progress (SDD/BDD) |
| **Surveyor (Agrimensor)** | Sovereign Graph Explorer (Visualizing nodes and connections) | 🔄 Planned |
| **Creek (O Riacho)** | Telemetry & Pulse Monitor (Streaming events and logs) | 🔄 Planned |

#### Pending Technical Work (Post-Graduation)

These items were discovered during tractor development and require follow-up:

| Item | Priority | Notes |
|------|----------|-------|
| Consumer testing with Rust daemon | Medium | 7 consumers tested with `tractor-ts`; end-to-end validation with native Rust daemon in production pending |
| Schema migration tooling | Medium | No migration script if user has a legacy `.db` from an older schema; `schema_compat_ts_db_readable` passes but no upgrade path documented |
| Cross-platform CI (Windows/macOS) | Low | CI currently Linux-only; acceptable for edge/IoT focus |
| Plugin manifest co-signing test | Low | Trust grants verified; co-signing of manifest not end-to-end tested |

### 🧠 Kernel-Level Agents
Cultivating AI directly into the Refarm execution engine ("Tractor").
- **Goal**: Inspired by operating systems incorporating AI at the kernel level, Refarm will expose local intelligence models as deep, secure, WASI-level primitives that plugins can invoke natively without external payload calls.
- **Flow**: Shared resources (e.g., local WebLLM or ONNX runtimes) managed natively by Farmhand, exposing an intelligent Oracle directly to the CRDT event loop.

### 🧩 Visual Plugin Builder (Low Code)
- A plugin that allows building other `.wasm` plugins visually from within Refarm Studio, generating the components at runtime to radically democratize ecosystem extension.

---

## 🚀 Vision 2026: AI Agent Sovereignty
Beyond v0.2.0, Refarm enters the "Sovereign Agent" era.

- **[Vision 2026 Proposal](../docs/proposals/VISION_2026_AI_AGENT_SOVEREIGNTY.md)**: Deep dive into the Agentic Autonomy roadmap.
- **Milestones**:
  - [ ] **Agentic Onboarding**: Natural language setup of the user's sovereign architecture during the first boot.
  - [ ] **Runtime Code Synthesis**: Agent-led generation and hot-swapping of WASM plugins and UI components.
  - [ ] **Universal Inference WIT**: Standardizing AI/LLM capabilities for the entire plugin ecosystem via WIT interfaces.
