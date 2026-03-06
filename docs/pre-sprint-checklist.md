# Pre-Sprint 1 Checklist (Semana 0)

**Status**: In Progress  
**Date**: 2026-03-06  
**Goal**: Complete remaining preparatory work before starting v0.1.0 Sprint 1  
**Related**: [Main Roadmap](../roadmaps/MAIN.md), [Validation 3](research/critical-validations.md#validação-3-wasi-capability-enforcement--em-progresso)

---

## Overview

This document tracks the **Semana 0** (Week 0) preparatory work required before beginning v0.1.0 Sprint 1. The roadmap assumes these foundational items are complete before SDD phase can start.

**Execution Model**: Parallel tracks with granular, checkable steps  
**Blocker Status**: Sprint 1 cannot start until all ✅ items complete

### Source of Truth (Readiness)

- This file is the canonical pre-start readiness document for Semana 0.
- `roadmaps/MAIN.md` should mirror only high-level status and link back here.
- `docs/decision-log.md` tracks decision state transitions and evidence links.
- **Current status summary**: See [ESTADO_ATUAL.md](ESTADO_ATUAL.md) for executive summary and next steps.

---

## Completed ✅

### ADRs Fundacionais

- [x] **ADR-001**: [Monorepo Structure and Workspace Boundaries](../specs/ADRs/ADR-001-monorepo-structure.md)
  - Turborepo + npm workspaces
  - Dependency rules
  - Package naming conventions
  - Build pipeline

- [x] **ADR-002**: [Offline-First Architecture](../specs/ADRs/ADR-002-offline-first-architecture.md)
  - Data flow: Storage → Sync → Network
  - Offline capability matrix
  - Write/read/sync paths
  - Testing strategy

- [x] **ADR-003**: [CRDT Choice (Yjs)](../specs/ADRs/ADR-003-crdt-synchronization.md)
  - Yjs rationale (13x faster than Automerge)
  - Performance benchmarks
  - Data types (Map, Array, Text)
  - Sync protocol

- [x] **ADR-009**: [OPFS Persistence Strategy](../specs/ADRs/ADR-009-opfs-persistence-strategy.md)
  - OPFS structure (vaults/, plugins/, backups/)
  - SQLite + OPFS integration
  - Quota management
  - Backup/restore strategy

### Contratos e Schemas

- [x] **WIT Contract**: [refarm-sdk.wit](../wit/refarm-sdk.wit)
  - Already well-defined (v0.1.0 ready)
  - Interfaces: `kernel-bridge`, `integration`
  - World: `refarm-plugin`

- [x] **JSON-LD Schema**: [sovereign-graph.jsonld](../schemas/sovereign-graph.jsonld)
  - Extended with 9 practical examples
  - Guest vault metadata
  - Permanent vault metadata
  - Collaborative board
  - Schema migration record

### Sub-Roadmaps Técnicos

- [x] **Kernel**: Added Technical Decisions section
  - Service registry pattern
  - Event bus architecture
  - Bootstrap sequence
  - Guest/permanent session handling
  - Error handling + self-healing
  - 📖 **README**: [Local Dev Setup Guide](../../apps/kernel/README.md)

- [x] **Storage**: Added Technical Decisions section
  - SQLite engine choice (wa-sqlite vs sql.js)
  - Schema design (nodes, migrations, FTS5)
  - JSON-LD storage strategy
  - Transaction + WAL mode
  - Migration system (ADR-010)

- [x] **Sync**: Added Technical Decisions section
  - Yjs data model mapping
  - IndexedDB persistence
  - Sync protocol (state-based + update-based)
  - Conflict resolution rules (LWW, OR-Set)
  - Storage integration

### Documentation & Developer Experience

- [x] **Kernel README**: [5-min local dev setup](../../apps/kernel/README.md)
  - Quick start (npm install → npm run dev)
  - Project structure
  - Core API preview
  - Testing strategy
  - Troubleshooting

---

## Pending ⚠️

### 1. WASM Validation (BLOCKER)

**File**: [wasm-validation.md](research/wasm-validation.md)  
**Implementation**: [validations/wasm-plugin/](../validations/wasm-plugin/)  
**Quick Start**: [validations/QUICK_START.md](../validations/QUICK_START.md)

**Status**: ⚠️ **Execution in progress (compile complete, browser runtime pending)**

**Tasks**:

- [ ] **Phase 1**: Compile hello-world plugin (Rust → WASM)
  - ✅ Install toolchain (cargo-component, wasm-tools) — see `setup-rust-toolchain.ps1`
  - ✅ Create plugin project — see `validations/wasm-plugin/hello-world/`
  - ✅ Implement minimal WIT interface — see `hello-world/src/lib.rs`
  - [x] Build and verify component: `cargo component build --release`

- [ ] **Phase 2**: Browser runtime (load WASM in browser)
  - ✅ Create PluginHost class (TypeScript) — see `validations/wasm-plugin/host/`
  - ✅ Implement kernel-bridge (host imports) — see `host/src/main.ts`
  - ✅ Create test page in Studio — see `host/index.html`
  - [ ] Verify plugin loads and executes: `npm run dev` in host/

- [ ] **Phase 3**: Capability enforcement
  - [ ] Add gated operation (fetch)
  - [ ] Host blocks unauthorized calls
  - [ ] Test denial and approval flows

- [ ] **Phase 4**: Performance baseline
  - [ ] Benchmark 1000 store-node calls
  - [ ] Verify < 0.1ms per call
  - [ ] Check for memory leaks

**Priority**: **HIGHEST** (blocks v0.1.0 if fails)

**Quick Start**: Run `cd validations && .\setup-rust-toolchain.ps1`, then follow [QUICK_START.md](../validations/QUICK_START.md)

---

### 2. SQLite Engine Decision (BLOCKER)

**File**: [ADR-015: SQLite Engine Decision](../specs/ADRs/ADR-015-sqlite-engine-decision.md)  
**Implementation**: [validations/sqlite-benchmark/](../validations/sqlite-benchmark/)  
**Quick Start**: [validations/QUICK_START.md](../validations/QUICK_START.md)

**Status**: ⚠️ **Benchmarks executed; OPFS browser validation still pending**

**Tasks**:

- [ ] **Benchmark wa-sqlite**:
  - ✅ Benchmark script created — see `validations/sqlite-benchmark/src/wa-sqlite.bench.ts`
  - [x] Run: `npm run bench:wa-sqlite`
  - [x] Document results in `validations/sqlite-benchmark/results.md`

- [ ] **Benchmark sql.js**:
  - ✅ Benchmark script created — see `validations/sqlite-benchmark/src/sql-js.bench.ts`
  - [x] Run: `npm run bench:sql-js`
  - [x] Document results in `validations/sqlite-benchmark/results.md`

- [ ] **Document decision**:
  - [x] Compare results side-by-side in `validations/sqlite-benchmark/results.md`
  - [x] Update ADR-015 with decision + rationale
  - [ ] Add rationale to storage-sqlite ROADMAP

**Priority**: **HIGH** (needed before storage implementation)

**Quick Start**: Run `cd validations/sqlite-benchmark && npm install && npm run bench:all`

---

### 3. ADRs Faltantes (IMPORTANT)

#### ADR-004: Identity Provider Choice (Nostr)

**Status**: Planned for v0.2.0

**Can defer to Sprint 3** (v0.2.0 starts), not needed for v0.1.0

---

#### ADR-010: JSON-LD Schema Evolution (Lenses)

**File**: [ADR-010: JSON-LD Schema Evolution](../specs/ADRs/ADR-010-schema-evolution.md)  
**Status**: ✅ Written (Lens-based upcasting approach)

**Included**:

- ✅ Migration strategy (version-based via @context)
- ✅ Upcasting pattern (Functional Lenses)
- ✅ Backwards compatibility guarantees (audit trail)
- ✅ Testing strategy (bulk migration <100ms for 1000 docs)
- ✅ Example implementation (TypeScript)

**Execution**: Ready for review  
**Priority**: **MEDIUM** (can be implemented in v0.2.0 + beyond)

---

#### ADR-013: Testing Strategy

**File**: [ADR-013: Testing Strategy](../specs/ADRs/ADR-013-testing-strategy.md)  
**Status**: ✅ Written (Vitest + Playwright + Changesets)

**Included**:

- ✅ **Unit tests**: Vitest (ESM-native, faster than Jest)
- ✅ **Integration tests**: Vitest + JSDOM
- ✅ **E2E tests**: Playwright (PWA + OPFS + P2P sync)
- ✅ **Coverage**: >80% lines, >70% branches
- ✅ **Changesets**: Atomic PR-based versioning
- ✅ **npm scripts**: Ready to use
- ✅ **Example test file**: Session lifecycle test

**Execution**: Ready for npm scripts setup  
**Priority**: **MEDIUM** (implement during TDD phase)

---

### 4. Repository Setup

#### Package Manager Configuration

**Status**: Needs verification

**Tasks**:

- [ ] Verify `npm@10.9.2` installed
- [ ] Run `npm install` in root (verify workspaces)
- [ ] Test `turbo build` (should skip empty packages gracefully)
- [ ] Test `turbo lint` (configure ESLint if missing)

**Execution**: Short setup task  
**Priority**: **LOW** (setup task, non-blocking for research)

---

#### CI/CD Pipeline

**File**: [.github/workflows/test.yml](../../.github/workflows/test.yml)  
**Status**: ✅ Baseline aligned (scripts/jobs exist); reliability now depends on project-owned tests and browser validations

**Current priorities**:

- [x] Root commands available: `test:unit`, `test:integration`, `test:e2e`
- [x] Turbo tasks aligned with workspace scripts (`test:unit` configured)
- [x] Changeset validation exists as dedicated workflow (`check-changeset`)
- [x] Seed smoke tests in critical workspaces to avoid "green with no signal"
- [ ] Validate browser-dependent checks (WASM host + OPFS) with evidence attached

**Priority**: **HIGH** (blocks trustworthy quality enforcement)

---

## Work Distribution (No Calendar)

### Track A: Technical Blockers

- [ ] Run WASM Phase 1 build and capture binary output path
- [ ] Run WASM Phase 2 browser host and validate full interaction flow
- [ ] Record metrics (load/setup/ingest + wasm size) in validation notes
- [ ] Execute both SQLite benchmarks (`wa-sqlite`, `sql.js`)
- [ ] Fill `validations/sqlite-benchmark/results.md` with raw numbers + side-by-side comparison
- [ ] Update `specs/ADRs/ADR-015-sqlite-engine-decision.md` with final decision

### Track B: Quality Gate Alignment

- [x] Decide and lock test runner strategy (Vitest-first + Jest transitive for tooling)
- [x] Make root commands executable: `test:unit`, `test:integration`, `test:e2e`
- [x] Align Turbo tasks with real workspace scripts
- [x] Ensure workspace test scripts run without local binary path assumptions
- [x] Keep smoke tests in critical workspaces (`kernel`, `storage-sqlite`, `sync-crdt`)
- [ ] Re-run local checks end-to-end (`lint`, `type-check`, tests)
- [ ] Confirm `.github/workflows/test.yml` matches available scripts and artifacts

### Track C: Documentation and Readiness

- [ ] Mark completed validation steps in this checklist and in `roadmaps/MAIN.md`
- [ ] Keep ADR-010 and ADR-013 as reference-ready (no new blockers introduced)
- [ ] Keep branch protection required checks aligned with real CI jobs
- [ ] Open PR only when Gate 1 + Gate 2 + Gate 3 are green

### Recommended Execution Order

- 1. Start Track A and Track B in parallel
- 2. Finish decision artifacts (ADR-015 + benchmark results)
- 3. Confirm CI/test gate integrity
- 4. Close readiness updates in docs and move to SDD

---

## Decision Gates

### Gate 1: WASM Validation Complete

**Condition**: All Phase 1-4 tasks ✅

**On Success**: Proceed to Sprint 1 (SDD phase)

**On Failure**:

- **Action**: Research alternatives:
  - Native Messaging (Chrome Extension API)
  - Web Workers without WASM (JS plugins, less secure)
  - Hybrid: Trusted plugins in JS, untrusted blocked
- **Impact**: Major architecture change, roadmap revision needed
- **Estimate**: +2 weeks research + redesign

---

### Gate 2: SQLite Engine Chosen

**Condition**: Benchmark complete, ADR-015 accepted

**On Success**: storage-sqlite implementation can start

**On Failure**: Unlikely (both libraries work), but would require:

- **Action**: Investigate alternative (DuckDB WASM, absurd-sql)
- **Impact**: Medium (+1 week)

---

### Gate 3: Testing Strategy Defined

**Condition**: ADR-013 accepted, test infra scaffolded, CI commands executable, and smoke tests present in critical workspaces

**On Success**: TDD phase can proceed smoothly

**On Failure**: Can proceed with basic setup, refine during Sprint 1

---

## Communication

**Status Updates**:

- Async status update per completed step batch: Post to project channel
- Blockers: Escalate immediately (don't wait)
- Completed gates: Announce in main channel

**Artifacts**:

- Commit frequently (atomic commits per ADR/validation)
- Push to `feat/pre-sprint-setup` branch
- PR to `main` only when Gate 1 + Gate 2 + Gate 3 are green

---

## Success Criteria

**Definition of Ready** (Sprint 1 can start):

- [x] ADRs 001, 002, 003, 009 accepted
- [x] ADR-010: Schema Evolution written and reviewed
- [x] ADR-013: Testing Strategy written and reviewed
- [x] ADR-015: SQLite Engine Decision written (pending validation)
- [x] Kernel README with quick start guide created
- [x] GitHub Actions CI/CD pipeline configured
- [x] Root quality scripts executable (`test:unit`, `test:integration`, `test:e2e`)
- [ ] WASM Validation complete (all phases ✅)
- [ ] SQLite engine decided (ADR-015 validated + accepted)
- [x] Smoke tests available in critical workspaces
- [ ] WIT contract verified (plugin compiles and runs)
- [ ] JSON-LD schema examples complete
- [ ] Sub-roadmaps have technical decisions

**When ready**:

- Update [MAIN.md](../roadmaps/MAIN.md) Pre-SDD checklist
- Move to Sprint 1: SDD phase begins
- Start writing specs (Kernel, Storage, Sync interfaces)

---

## Notes

**What if we find blockers?**

- WASM doesn't work → Pivot to alternative (see Gate 1)
- SQLite too slow → Consider DuckDB WASM
- Scope pressure → Defer non-blockers (ADR-010/013), keep blocker tracks first

**Pragmatism**:

- Don't gold-plate: Good enough > perfect too late
- Validate, don't speculate: Run code, measure performance
- Document surprises: Update memory notes when assumptions break

---

## References

- [Main Roadmap](../roadmaps/MAIN.md)
- [Critical Validations](research/critical-validations.md)
- [WASM Validation Checklist](research/wasm-validation.md)
- [ADR Index](../specs/ADRs/README.md)
