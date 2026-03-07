# ADR Index

Architecture Decision Records for Refarm.

---

## Active Decisions

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [001](ADR-001-monorepo-structure.md) | Monorepo Structure and Workspace Boundaries | Accepted | 2026-03-06 |
| [002](ADR-002-offline-first-architecture.md) | Offline-First Architecture | Accepted | 2026-03-06 |
| [003](ADR-003-crdt-synchronization.md) | CRDT Choice (Yjs) | Accepted | 2026-03-06 |
| [005](ADR-005-network-abstraction-layer.md) | Network Abstraction Layer | Accepted | 2026-03-06 |
| [006](ADR-006-guest-mode-collaborative-sessions.md) | Guest Mode and Collaborative Sessions | Accepted | 2026-03-06 |
| [007](ADR-007-observability-primitives.md) | Observability & Introspection Primitives | Draft | 2026-03-05 |
| [008](ADR-008-ecosystem-technology-boundary.md) | Ecosystem Technology Boundary (Go vs TypeScript) | Accepted | 2026-03-05 |
| [009](ADR-009-opfs-persistence-strategy.md) | OPFS Persistence Strategy | Accepted | 2026-03-06 |
| [010](ADR-010-schema-evolution.md) | JSON-LD Schema Evolution (Lenses & Upcasting) | Accepted | 2026-03-06 |
| [013](ADR-013-testing-strategy.md) | Testing Strategy (Vitest + Playwright) | Accepted | 2026-03-06 |
| [016](ADR-016-headless-ui-contract.md) | Headless UI Contract and Token Strategy | Proposed | 2026-03-07 |
| [017](ADR-017-studio-micro-kernel-and-plugin-boundary.md) | Studio Micro-Kernel and Plugin Boundary | Accepted | 2026-03-07 |
| [018](ADR-018-capability-contracts-and-observability-gates.md) | Capability Contracts and Observability Gates | Accepted | 2026-03-07 |
| [019](ADR-019-npm-scope-and-namespace-strategy.md) | npm Scope and Namespace Strategy (@refarm.dev) | Accepted | 2026-03-07 |


## Planned (Future ADRs)

---

## Under Design (Requires Implementation + Tests Before Acceptance)

These ADRs define architecture direction but are NOT executable contracts yet. Sprint 2+ implementation required.

| ADR | Title | Status | Target | Blockers |
|-----|-------|--------|--------|----------|
| [020](ADR-020-sovereign-graph-versioning.md) | Sovereign Graph Versioning (commit/branch/checkout/revert) | ✏️ Proposed | v0.2.0-0.3.0 | 30+ invariant tests + kernel implementation |
| [021](ADR-021-self-healing-and-plugin-citizenship.md) | Self-Healing & Plugin Citizenship Monitoring | ✏️ Proposed | v0.3.0+ | 40+ integration tests + kernel implementation |

---

## Planned (Future ADRs)

| ADR | Title | Target | Status |
|-----|-------|--------|--------|
| 004 | Identity Provider Choice (Nostr) | v0.2.0 | Planned |
| 011 | Plugin Marketplace (NIP-89/94) | v0.4.0 | Planned |
| 012 | LLM Execution Strategy (WebLLM) | v0.3.0 | Planned |
| 014 | Model Selection Criteria (size, performance, licensing) | v0.3.0 | Planned |

**Note**: Planned ADRs are reserved numbers for upcoming decisions. They will be created when their milestone begins.  
**Priority**: Keep planned ADRs aligned with milestones and avoid duplicating accepted ADR numbers.

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
