# Refarm - Evolutionary Roadmap

**Semantic Versioning**: Major.Minor.Patch  
**Current**: v0.0.1-dev  
**Target Architecture Stability**: v0.1.0 (Sovereign Foundations)

---

## 🛑 Strict Release Policy (Pre v0.1.0)

Refarm is intentionally being held in `< 0.1.x` during this architectural stabilization phase. The project represents a paradigm shift (Sovereignty + WASM + CRDTs), and we must perfect the core "Universal Blocks" before minting `v0.1.0`.

No packages will advance to `v1.0` or even `v0.1` until Refarm is credible as the creator's daily driver: the tool used instead of an external pi instance for planning, coding, memory, automation, and local agent work.

That implies:

1. The headless runtime (`Tractor Node`), browser execution contexts (`Studio/Homestead`), and pi-inspired agent loop are reliable enough for daily work.
2. Core building blocks (`sync-loro`, `storage-sqlite`, `tractor`, etc.) are stable where they sit on the daily-driver critical path, not merely complete as abstract libraries.
3. Migration/publishing structure is clear enough that releasing `v0.1.0` will not freeze obsolete pre-pi assumptions.

Each release follows: **SDD → BDD → TDD → DDD** (see [Workflow Guide](../docs/WORKFLOW.md))

- **Current Strategy**: [Strategic Research](./STRATEGIC_RESEARCH.md) (OPAQUE, Spin, TEM).
- **Tooling Hygiene**: [VTConfig](../packages/vtconfig/ROADMAP.md) (Atomic Resolution Matrix).

### Roadmap Recalibration (pi-era)

Older `v0.2.0+` headings are capability buckets, not release promises. They were written before the current pi-influenced operating model and should be treated as backlog labels until the daily-driver gate is satisfied. If a milestone does not make Refarm better as the creator's replacement for pi, it should be deferred, renamed, or deleted rather than promoted by version number.

---

## v0.1.0 - Sovereign Foundations

**Milestone**: The culmination of Phase 1 through Phase 6. A stable, offline-first execution engine (`Tractor`) capable of hosting capability-isolated WASM plugins, bidirectionally synchronizing via Loro CRDTs, and orchestrating work across local Tractor Nodes.

**Status**: In Progress (Phase 6 Finalization)

### Phase 1 to Phase 5: Architecture Bootstrapping ✅

_Historical milestones achieved during earlier sprints._

- ✅ ADR-001/008: Monorepo structure, Turborepo, NPM workspaces.
- ✅ ADR-002/009: Offline-first architecture and OPFS persistence.
- ✅ ADR-015: SQLite Engine abstraction.
- ✅ ADR-025: Pure Microkernel mapping — `Tractor` routing WASI calls agnostically.
- ✅ ADR-036/042: Sovereign Bootloader, Homestead modularization.
- ✅ ADR-037: Infrastructure Escalation Strategy (Mailboxes, Webhooks).

### Phase 6: Sync & Execution Stabilization 🚧 (CURRENT)

_Consolidating the engine's core capabilities (CRDT and Plugin runtime) based on the Snapshot Plan._

Operational governance baseline (factory/cross-agent):

- ✅ Domain gates standardized (`gate:smoke:foundation`, `gate:smoke:contracts`, `gate:smoke:runtime`, `gate:full:colony`).
- ✅ Colony playbook published (`docs/COLONY_PLAYBOOK.md`) with preflight, escalation, and reviewer handoff templates.
- ✅ Transition policy documented for pi-now operations vs Refarm-agent migration path (decision alignment in `.project/decisions.json`).

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

**Identity (first deliverable — can start now, see [Identity Roadmap](./OPAQUE.md)):**

- [ ] `identity-nostr` WASM adapter — implements `sign/verify/public-key/derive-from-session` from `world refarm-identity-plugin` WIT (commit `07f338b`).
- [ ] Validation plugin in `validations/identity-nostr-plugin/` (Rust, `cargo-component`).

**Discovery & Graph:**

- [ ] Implement remote source resolution (fetching plugins via Sovereign Graph from URLs/IPFS).
- [ ] Connect the `Registry` (identifying plugins in the graph) to `Tractor` (dynamically loading components on demand).
- [ ] Enable Tractor to inject dynamic Sovereign Graph configurations into plugins upon activation.

---

## Strategic R&D Tracks

These tracks run parallel to the core version bumps and represent ongoing Research & Development to push the boundaries of the Sovereign Web.

### 🛡️ Opaque Protocol (Identity)

Strategic roadmap for RFC-grade password-based authentication.

> Roadmap detalhado: [`packages/tractor/docs/OPAQUE.md`](../packages/tractor/docs/OPAQUE.md)

### 🌀 Spin Synergy (Runtime)

Aligning Refarm with Spin v3's modular "Factors" and component composition, com foco na padronização de interfaces (WIT/WASI) para convergência incremental.

> Roadmap detalhado: [`packages/tractor/docs/SPIN_SYNERGY.md`](../packages/tractor/docs/SPIN_SYNERGY.md)

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

| Plugin                    | Purpose                                                      | Roadmap                                                               | Status                   |
| ------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------ |
| **Barn (O Celeiro)**      | Machinery Manager (Plugin lifecycle, OPFS cache, SHA-256)    | [`packages/barn/ROADMAP.md`](../packages/barn/ROADMAP.md)             | 🚧 In Progress (SDD/BDD) |
| **Surveyor (Agrimensor)** | Sovereign Graph Explorer (Visualizing nodes and connections) | [`packages/surveyor/ROADMAP.md`](../packages/surveyor/ROADMAP.md)     | 🔄 Planned               |
| **Creek (O Riacho)**      | Telemetry & Pulse Monitor (Streaming events and logs)        | [`packages/creek/ROADMAP.md`](../packages/creek/ROADMAP.md)           | 🔄 Planned               |
| **Registry**              | Plugin Discovery & Validation                                | [`packages/registry/ROADMAP.md`](../packages/registry/ROADMAP.md)     | ✅ Foundation            |
| **Silo**                  | Context & Secret Provisioner                                 | [`packages/silo/ROADMAP.md`](../packages/silo/ROADMAP.md)             | ✅ Foundation            |
| **Plugin-TEM**            | AI/Reasoning Engine                                          | [`packages/plugin-tem/ROADMAP.md`](../packages/plugin-tem/ROADMAP.md) | 🚧 In Progress           |
| **Windmill**              | Automation & Workflows                                       | [`packages/windmill/ROADMAP.md`](../packages/windmill/ROADMAP.md)     | 🚧 In Progress           |
| **Sower/Thresher**        | Seed & Harvest (ETL)                                         | [`packages/sower/ROADMAP.md`](../packages/sower/ROADMAP.md)           | 🚧 In Progress           |

---

### Tooling & Infrastructure

| Component           | Purpose                                  | Roadmap                                                                         |
| ------------------- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| **CLI**             | Refarm Developer Tool (`refarm` command) | [`packages/cli/ROADMAP.md`](../packages/cli/ROADMAP.md)                         |
| **Plugin-Manifest** | Plugin Metadata Contract                 | [`packages/plugin-manifest/ROADMAP.md`](../packages/plugin-manifest/ROADMAP.md) |
| **Toolbox**         | Common utilities and build tools         | [`packages/toolbox/ROADMAP.md`](../packages/toolbox/ROADMAP.md)                 |
| **Config**          | Sovereign Settings Manager               | [`packages/config/ROADMAP.md`](../packages/config/ROADMAP.md)                   |

---

### Security & Health Utilities

| Component          | Purpose                            | Roadmap                                                                       |
| ------------------ | ---------------------------------- | ----------------------------------------------------------------------------- |
| **Fence**          | Sandboxing & Capability Gating     | [`packages/fence/ROADMAP.md`](../packages/fence/ROADMAP.md)                   |
| **Health**         | System Diagnostics                 | [`packages/health/ROADMAP.md`](../packages/health/ROADMAP.md)                 |
| **Scarecrow**      | Policy & Validation                | [`packages/scarecrow/ROADMAP.md`](../packages/scarecrow/ROADMAP.md)           |
| **Plugin-Courier** | Broadcast & Materializer (Antenna) | [`packages/plugin-courier/ROADMAP.md`](../packages/plugin-courier/ROADMAP.md) |
| **DS**             | Design System & Tokens             | [`packages/ds/ROADMAP.md`](../packages/ds/ROADMAP.md)                         |
| **VTConfig**       | Vitest Configuration & Aliases     | [`packages/vtconfig/ROADMAP.md`](../packages/vtconfig/ROADMAP.md)             |

---

### Foundational Layers

These packages form the core bedrock of Refarm's architecture.

| Layer         | Purpose                       | Roadmap                                                                             |
| ------------- | ----------------------------- | ----------------------------------------------------------------------------------- |
| **Heartwood** | Security Kernel (WASM Crypto) | [`packages/heartwood/ROADMAP.md`](../packages/heartwood/ROADMAP.md)                 |
| **Homestead** | Browser environment (SDK/IDE) | [`packages/homestead/ROADMAP.md`](../packages/homestead/ROADMAP.md)                 |
| **Sync-Loro** | CRDT Sync Engine              | [`packages/sync-loro/ROADMAP.md`](../packages/sync-loro/ROADMAP.md)                 |
| **Tractor**   | Microkernel (Native Host)     | [`packages/tractor/docs/SPIN_SYNERGY.md`](../packages/tractor/docs/SPIN_SYNERGY.md) |

#### Pending Technical Work (Post-Graduation)

These items were discovered during tractor development and require follow-up:

| Item                              | Priority | Notes                                                                                                                                     |
| --------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Consumer testing with Rust daemon | Medium   | 7 consumers tested with `tractor-ts`; end-to-end validation with native Rust daemon in production pending                                 |
| Schema migration tooling          | Medium   | No migration script if user has a legacy `.db` from an older schema; `schema_compat_ts_db_readable` passes but no upgrade path documented |
| Cross-platform CI (Windows/macOS) | Low      | CI currently Linux-only; acceptable for edge/IoT focus                                                                                    |
| Plugin manifest co-signing test   | Low      | Trust grants verified; co-signing of manifest not end-to-end tested                                                                       |

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
