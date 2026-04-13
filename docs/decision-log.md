# Decision Log

Central register for high-impact technical decisions that are pending or recently accepted.

---

## Daemon Runtime Role: Tractor Node is Canonical, Farmhand is Transitional

**Date**: 2026-04-13
**Status**: Accepted
**References**: [ADR-048](../specs/ADRs/ADR-048-tractor-graduation.md), [ADR-049](../specs/ADRs/ADR-049-post-graduation-horizon.md)

**Decision**: The canonical daemon runtime is the `tractor` node (`ws://localhost:42000`).
`apps/farmhand` remains only as a transitional compatibility layer until CLI, docs, and plugin routing
are fully converged on Tractor terminology and flows.

**What this means now**:
- User-facing docs and commands should reference "Tractor node" as the default daemon.
- `apps/farmhand` can remain in-repo temporarily to preserve migration continuity.
- No deprecation note is required in the main README; track migration via internal docs and ADR lineage.

**Exit criteria to retire Farmhand**:
- CLI commands and messages no longer reference Farmhand.
- Release/docs flows are fully aligned with Tractor node and Pi node language.
- Plugin lifecycle paths (discover, load, route, execute) validated end-to-end under Tractor runtime.

---

## Composition Model: Blocks and Distros

**Date**: 2026-03-17
**Status**: Accepted
**ADR**: [ADR-046](../specs/ADRs/ADR-046-refarm-composition-model.md)

**Decision**: Establish an explicit two-layer architecture. `packages/` are philosophy-neutral
blocks that any developer can use to build any type of application (centralized, hybrid, or
sovereign). `apps/` are opinionated distros that carry Refarm's sovereign philosophy. Blocks
never assume local-first; distros are free to be as opinionated as needed.

**New block**: `@refarm.dev/storage-rest` — first block explicitly targeting centralized apps.
Implements `StorageAdapter` by proxying to any REST API. Proves that Tractor works as a plugin
host for traditional web applications without requiring CRDT or P2P.

**Dogfood rule**: Every Refarm distro must be buildable entirely from Refarm blocks.

**Impact**:
- `specs/ADRs/ADR-046-refarm-composition-model.md` created
- `docs/ARCHITECTURE.md` updated with Composition Model section
- `packages/storage-rest/` created as `@refarm.dev/storage-rest`
- No breaking changes to any existing package

---

## CRDT Engine: Loro replaces Yjs

**Date**: 2026-03-17
**Status**: Accepted
**ADR**: [ADR-045](../specs/ADRs/ADR-045-loro-crdt-adoption.md)
**Supersedes**: [ADR-003 (Yjs)](../specs/ADRs/ADR-003-crdt-synchronization.md)
**Implements**: [ADR-028 (CRDT-SQLite convergence)](../specs/ADRs/ADR-028-crdt-sqlite-convergence-strategy.md)

**Decision**: Adopt `loro-crdt` (Rust-core + WASM) as the CRDT engine. Implement the CQRS
pattern from ADR-028: `LoroDoc` as the write model (source of truth), SQLite as the materialized
read model (projected by a `Projector` that listens to `LoroDoc.subscribe`).

**Key advantages over Yjs**: `LoroTree` with concurrent-move cycle detection, shallow snapshots
for RPi/IoT targets, built-in time travel, single npm package for browser and daemon (no separate
provider ecosystem), Rust-core correctness.

**Impact**:
- New package: `@refarm.dev/sync-loro` — the **only** package that depends on `loro-crdt`
- `apps/farmhand/`: wired with `LoroCRDTStorage`; WebSocket transport changed to binary (`Uint8Array`)
- `packages/homestead/`: `BrowserSyncClient` added for browser ↔ farmhand sync
- `packages/sync-crdt/`: preserved as conceptual reference, no longer in production sync path
- Zero breaking changes to `StorageAdapter`, `SyncAdapter`, or plugin contracts

---

## Sprint 1 Readiness Status

**Date**: 2026-03-07  
**Phase**: Semana 0 → Sprint 1 SDD  
**Overall Status**: 🟢 **READY** (preparation complete)

### Pre-Sprint 1 Blockers

| Blocker | Requirement | Current State | Timeline |
|---------|-------------|---------------|----------|
| WASM Browser Runtime | Validate Rust plugin runs in browser + calls tractor-bridge | ✅ Compilation OK, ⚠️ Runtime untested | ~30 min (test now) |
| OPFS Persistence | Validate wa-sqlite + OPFS performance in browser | ✅ Node benchmark done, ⚠️ Browser pending | ~1-2h (test now) OR defer to Sprint 1 pre-BDD |

**Pragmatic Decision Matrix**:

- ✅ WASM + ✅ OPFS → **GO**: Start Sprint 1 immediately
- ✅ WASM + ⚠️ OPFS (defer) → **GO with caveat**: Add OPFS as Sprint 1 pre-BDD gate
- ✅ WASM + ❌ OPFS → **PAUSE**: Research alternatives (1w)
- ❌ WASM → **PIVOT**: Architecture redesign needed (2+ weeks)

**Recommendation**: Execute WASM validation now (~30 min), then decide on OPFS based on available time.

### What's Been Completed (2026-03-06)

✅ **Documentation consolidation**: Single source of truth established

- `docs/pre-sprint-checklist.md` → canonical Semana 0 readiness reference
- `roadmaps/MAIN.md` → synchronized with current status
- Smoke tests seeded in critical workspaces (tractor, storage-sqlite, sync-crdt)

✅ **Quality gates validated**: CI/test pipeline operational

- Root scripts: `test:unit`, `test:integration`, `test:e2e` ✓
- Turbo tasks aligned ✓
- Changeset workflow configured ✓

✅ **Deliverables prepared**:

- Sprint 1 SDD checklist created
- 5 feature specs ready (Session, Storage Tiers, Migration, Plugin, Schema)
- ADR-015 (SQLite) documented with provisional status

### References

- Detailed checklist: [pre-sprint-checklist.md](pre-sprint-checklist.md)
- Roadmap: [../roadmaps/MAIN.md](../roadmaps/MAIN.md)
- SQLite decision: [../specs/ADRs/ADR-015-sqlite-engine-decision.md](../specs/ADRs/ADR-015-sqlite-engine-decision.md)
- WASM validation: [../docs/research/wasm-validation.md](../docs/research/wasm-validation.md)

---

## In Progress

| Topic | ADR | Owner | Status | Due | Evidence |
|---|---|---|---|---|---|
| WASM + WIT capability enforcement | Validation 3 | Core | In progress | 2026-03-08 | docs/research/wasm-validation.md |

---

## Recently Accepted

| Topic | ADR | Date | Notes |
|---|---|---|---|
| Monorepo structure and boundaries | ADR-001 | 2026-03-06 | Turborepo + workspaces |
| Offline-first architecture | ADR-002 | 2026-03-06 | Storage -> Sync -> Network |
| CRDT choice (Yjs) | ADR-003 | 2026-03-06 | Benchmark-backed decision |
| OPFS persistence strategy | ADR-009 | 2026-03-06 | Vault layout and quota handling |
| JSON-LD schema evolution strategy | ADR-010 | 2026-03-06 | Lens-based upcasting and compatibility guarantees documented |
| Testing strategy (unit/integration/e2e) | ADR-013 | 2026-03-06 | Vitest + Playwright + Changesets strategy documented |
| SQLite engine choice (wa-sqlite vs sql.js) | ADR-015 | 2026-03-13 | Accepted; WASM+WIT lifecycle and Node bench verified |
| Native browser permissions as proxy capabilities | ADR-029 | 2026-03-07 | Capabilities as superset of browser native permissions |
| Astro type-checking in pre-push hooks | (inline) | 2026-03-09 | Added `astro check` to homestead lint/type-check; tsc does not verify `.astro` files |
| Rust WASM plugin compilation in CI | (inline) | 2026-03-09 | Added Rust toolchain + WASM build steps to test.yml and granular-tests.yml; JCO integration tests require pre-compiled plugin binary |

---

## Usage

- Update this file whenever a decision changes state (`Planned`, `In progress`, `Accepted`, `Rejected`).
- Link the final ADR file and supporting benchmark/checklist evidence.
- Keep this log lightweight: one row per decision.
