# Pre-Sprint 1 Checklist (Semana 0)

**Status**: In Progress  
**Date**: 2026-03-06  
**Goal**: Complete remaining preparatory work before starting v0.1.0 Sprint 1  
**Related**: [Main Roadmap](../roadmaps/MAIN.md), [Validation 3](research/critical-validations.md#validação-3-wasi-capability-enforcement--em-progresso)

---

## Overview

This document tracks the **Semana 0** (Week 0) preparatory work required before beginning v0.1.0 Sprint 1. The roadmap assumes these foundational items are complete before SDD phase can start.

**Timeline**: 5-7 days (1 week)  
**Blocker Status**: Sprint 1 cannot start until all ✅ items complete

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

- [x] **Storage**: Added Technical Decisions section
  - SQLite engine choice (wa-sqlite vs sql.js)
  - Schema design (nodes, migrations, FTS5)
  - JSON-LD storage strategy
  - Transaction + WAL mode
  - Migration system

- [x] **Sync**: Added Technical Decisions section
  - Yjs data model mapping
  - IndexedDB persistence
  - Sync protocol (state-based + update-based)
  - Conflict resolution rules (LWW, OR-Set)
  - Storage integration

---

## Pending ⚠️

### 1. WASM Validation (BLOCKER)

**File**: [wasm-validation.md](research/wasm-validation.md)

**Status**: Checklist created, execution pending

**Tasks**:

- [ ] **Phase 1**: Compile hello-world plugin (Rust → WASM)
  - [ ] Install toolchain (cargo-component, wasm-tools)
  - [ ] Create plugin project
  - [ ] Implement minimal WIT interface
  - [ ] Build and verify component
  - **Effort**: 4 hours

- [ ] **Phase 2**: Browser runtime (load WASM in browser)
  - [ ] Create PluginHost class (TypeScript)
  - [ ] Implement kernel-bridge (host imports)
  - [ ] Create test page in Studio
  - [ ] Verify plugin loads and executes
  - **Effort**: 8 hours

- [ ] **Phase 3**: Capability enforcement
  - [ ] Add gated operation (fetch)
  - [ ] Host blocks unauthorized calls
  - [ ] Test denial and approval flows
  - **Effort**: 4 hours

- [ ] **Phase 4**: Performance baseline
  - [ ] Benchmark 1000 store-node calls
  - [ ] Verify < 0.1ms per call
  - [ ] Check for memory leaks
  - **Effort**: 2 hours

**Timeline**: 2 days  
**Priority**: **HIGHEST** (blocks v0.1.0 if fails)

---

### 2. SQLite Engine Decision (BLOCKER)

**Status**: ADR-008 drafted but decision pending

**Tasks**:

- [ ] **Benchmark wa-sqlite**:
  - [ ] 100k inserts (OPFS)
  - [ ] Query performance (indexed vs non-indexed)
  - [ ] Memory usage
  - [ ] Initial load time

- [ ] **Benchmark sql.js**:
  - [ ] Same tests as wa-sqlite
  - [ ] Compare bundle sizes
  - [ ] Test OPFS serialization overhead

- [ ] **Document results**:
  - [ ] Create `docs/research/sqlite-benchmark.md`
  - [ ] Update ADR-008 with decision
  - [ ] Add rationale to storage-sqlite ROADMAP

**Timeline**: 1 day  
**Priority**: **HIGH** (needed before storage implementation)

---

### 3. ADRs Faltantes (IMPORTANT)

#### ADR-004: Identity Provider Choice (Nostr)

**Status**: Planned for v0.2.0

**Can defer to Sprint 3** (v0.2.0 starts), not needed for v0.1.0

---

#### ADR-010: JSON-LD Schema Evolution (Lenses)

**Status**: Not started

**Decision needed**:

- Migration strategy (version-based vs timestamp)
- Upcasting pattern (Lenses or SQL scripts)
- Backwards compatibility guarantees

**Tasks**:

- [ ] Research Elm's Lens pattern for JSON evolution
- [ ] Define migration file format
- [ ] Specify `migrations/` directory structure
- [ ] Write ADR-010

**Timeline**: 4 hours  
**Priority**: **MEDIUM** (can be refined during BDD phase)

---

#### ADR-013: Testing Strategy

**Status**: Not started

**Decision needed**:

- Unit test framework (Vitest vs Jest)
- Integration test approach
- E2E framework (Playwright mandatory)
- Coverage targets (>80%)
- CI/CD pipeline

**Tasks**:

- [ ] Evaluate Vitest vs Jest for TypeScript monorepo
- [ ] Define test file structure (`__tests__/` vs `*.test.ts`)
- [ ] Create test setup (mocks, fixtures)
- [ ] Write ADR-013

**Timeline**: 4 hours  
**Priority**: **MEDIUM** (needed before TDD phase, but not SDD)

---

### 4. Repository Setup

#### Package Manager Configuration

**Status**: Needs verification

**Tasks**:

- [ ] Verify `npm@10.9.2` installed
- [ ] Run `npm install` in root (verify workspaces)
- [ ] Test `turbo build` (should skip empty packages gracefully)
- [ ] Test `turbo lint` (configure ESLint if missing)

**Timeline**: 1 hour  
**Priority**: **LOW** (setup task, non-blocking for research)

---

#### CI/CD Pipeline

**Status**: Not configured

**Tasks**:

- [ ] Create `.github/workflows/ci.yml`
- [ ] Jobs: lint, test, build (per workspace)
- [ ] Matrix strategy (Node 20.x, latest Chrome)
- [ ] Artifact upload (test coverage, build outputs)

**Timeline**: 2 hours  
**Priority**: **LOW** (can be done in Sprint 1)

---

## Timeline Summary

| Task | Priority | Effort | Days | Can Defer? |
|------|----------|--------|------|------------|
| WASM Validation | 🔴 HIGHEST | 18h | 2-3 | ❌ BLOCKER |
| SQLite Benchmark | 🟠 HIGH | 6h | 1 | ❌ BLOCKER |
| ADR-010 (Schema Evolution) | 🟡 MEDIUM | 4h | 0.5 | ⚠️ Recommended |
| ADR-013 (Testing) | 🟡 MEDIUM | 4h | 0.5 | ⚠️ Recommended |
| Repo Setup | 🟢 LOW | 1h | 0.5 | ✅ Can defer |
| CI/CD | 🟢 LOW | 2h | 0.5 | ✅ Can defer |
| **TOTAL** | | **35h** | **5 days** | |

**Recommended Schedule** (conservative):

- **Day 1-2**: WASM Validation (Phases 1-4)
- **Day 3**: SQLite Benchmark + Decision
- **Day 4**: ADR-010 + ADR-013
- **Day 5**: Buffer (review, cleanup, repo setup)

**Aggressive Schedule** (parallel work):

- **Day 1**: WASM Phase 1 + SQLite setup
- **Day 2**: WASM Phase 2 + SQLite benchmarks
- **Day 3**: WASM Phase 3-4 + ADR-010 + ADR-013
- Buffer already built in

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

**Condition**: Benchmark complete, ADR-008 accepted

**On Success**: storage-sqlite implementation can start

**On Failure**: Unlikely (both libraries work), but would require:

- **Action**: Investigate alternative (DuckDB WASM, absurd-sql)
- **Impact**: Medium (+1 week)

---

### Gate 3: Testing Strategy Defined

**Condition**: ADR-013 accepted, test infra scaffolded

**On Success**: TDD phase can proceed smoothly

**On Failure**: Can proceed with basic setup, refine during Sprint 1

---

## Communication

**Status Updates**:

- Daily standup (async): Post to project channel
- Blockers: Escalate immediately (don't wait)
- Completed gates: Announce in main channel

**Artifacts**:

- Commit frequently (atomic commits per ADR/validation)
- Push to `feat/pre-sprint-setup` branch
- PR to `main` when Gate 1 + Gate 2 complete

---

## Success Criteria

**Definition of Ready** (Sprint 1 can start):

- [x] ADRs 001, 002, 003, 009 accepted
- [ ] WASM Validation complete (all phases ✅)
- [ ] SQLite engine decided (ADR-008 updated)
- [ ] Testing strategy drafted (ADR-013 accepted)
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
- Time runs over → Defer non-blockers (ADR-010/013, CI/CD)

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
