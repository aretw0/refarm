# Decision Log

Central register for high-impact technical decisions that are pending or recently accepted.

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

---

## Usage

- Update this file whenever a decision changes state (`Planned`, `In progress`, `Accepted`, `Rejected`).
- Link the final ADR file and supporting benchmark/checklist evidence.
- Keep this log lightweight: one row per decision.
