# Decision Log

Central register for high-impact technical decisions that are pending or recently accepted.

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
| SQLite engine choice (wa-sqlite vs sql.js) | ADR-015 | 2026-03-06 | Accepted provisionally; Node benchmark completed, browser OPFS validation pending |
| Quality gate baseline alignment | ADR-013 | 2026-03-06 | Root scripts and CI jobs aligned; smoke-test baseline seeded in critical workspaces |
| Native browser permissions as proxy capabilities | ADR-024 | 2026-03-07 | Capabilities as superset of browser native permissions |
| Astro type-checking in pre-push hooks | (inline) | 2026-03-09 | Added `astro check` to homestead lint/type-check; tsc does not verify `.astro` files |

---

## Usage

- Update this file whenever a decision changes state (`Planned`, `In progress`, `Accepted`, `Rejected`).
- Link the final ADR file and supporting benchmark/checklist evidence.
- Keep this log lightweight: one row per decision.
