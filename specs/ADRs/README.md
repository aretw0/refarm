# ADR Index

Architecture Decision Records for Refarm.

---

## Active Decisions

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [001](ADR-001-monorepo-structure.md) | Monorepo Structure and Workspace Boundaries | Accepted | 2026-03-06 |
| [002](ADR-002-offline-first-architecture.md) | Offline-First Architecture | Accepted | 2026-03-06 |
| [003](ADR-003-crdt-synchronization.md) | CRDT Choice (Yjs) | Accepted | 2026-03-06 |
| [005](ADR-005-network-abstraction-layer.md) | Network Abstraction Layer | Proposed | 2026-03-05 |
| [006](ADR-006-guest-mode-collaborative-sessions.md) | Guest Mode and Collaborative Sessions | Proposed | 2026-03-05 |
| [007](ADR-007-observability-primitives.md) | Observability & Introspection Primitives | Draft | 2026-03-05 |
| [008](ADR-008-ecosystem-technology-boundary.md) | Ecosystem Technology Boundary (Go vs TypeScript) | Accepted | 2026-03-05 |
| [009](ADR-009-opfs-persistence-strategy.md) | OPFS Persistence Strategy | Accepted | 2026-03-06 |

---

## Planned (Future ADRs)

| ADR | Title | Target | Status |
|-----|-------|--------|--------|
| 004 | Identity Provider Choice (Nostr) | v0.2.0 | Planned |
| 010 | JSON-LD Schema Evolution (Lenses) | v0.1.0 | Planned |
| 011 | Plugin Marketplace (NIP-89/94) | v0.4.0 | Planned |
| 012 | LLM Execution Strategy (WebLLM) | v0.3.0 | Planned |
| 013 | Testing Strategy (Vitest + Playwright) | v0.1.0 | Planned |
| 014 | Model Selection Criteria (size, performance, licensing) | v0.3.0 | Planned |
| 015 | SQLite Engine Choice (wa-sqlite vs sql.js) | v0.1.0 | Planned |
| 016 | Embedding Generation Strategy (Transformers.js vs WebLLM) | v0.3.0 | Planned |

**Note**: Planned ADRs are reserved numbers for upcoming decisions. They will be created when their milestone begins.  
**Priority**: ADRs 010 and 013 are needed before v0.1.0 SDD phase can complete.

---

## Superseded/Deprecated

*(None yet)*

---

## How to Create an ADR

1. Copy [template.md](template.md)
2. Rename to `ADR-XXX-brief-title.md`
3. Fill in all sections
4. Submit for review
5. Update this index when accepted
