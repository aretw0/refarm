# ADR Index

Architecture Decision Records for Refarm.

---

## Active Decisions

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [001](ADR-001-monorepo-structure.md) | Monorepo Structure and Workspace Boundaries | Accepted | 2026-03-06 |
| [002](ADR-002-offline-first-architecture.md) | Offline-First Architecture | Accepted | 2026-03-06 |
| [003](ADR-003-crdt-synchronization.md) | CRDT Choice (Yjs) | Superseded | 2026-03-06 |
| [005](ADR-005-network-abstraction-layer.md) | Network Abstraction Layer | Accepted | 2026-03-06 |
| [006](ADR-006-guest-mode-collaborative-sessions.md) | Guest Mode and Collaborative Sessions | Accepted | 2026-03-06 |
| [007](ADR-007-observability-primitives.md) | Observability & Introspection Primitives | Draft | 2026-03-05 |
| [008](ADR-008-ecosystem-technology-boundary.md) | Ecosystem Technology Boundary (Go vs TypeScript) | Accepted | 2026-03-05 |
| [009](ADR-009-opfs-persistence-strategy.md) | OPFS Persistence Strategy | Accepted | 2026-03-06 |
| [010](ADR-010-schema-evolution.md) | JSON-LD Schema Evolution (Lenses & Upcasting) | Accepted | 2026-03-06 |
| [013](ADR-013-testing-strategy.md) | Testing Strategy (Vitest + Playwright) | Accepted | 2026-03-06 |
| [015](ADR-015-sqlite-engine-decision.md) | SQLite Engine Decision | Accepted | 2026-03-06 |
| [016](ADR-016-headless-ui-contract.md) | Headless UI Contract and Token Strategy | Proposed | 2026-03-07 |
| [017](ADR-017-studio-micro-kernel-and-plugin-boundary.md) | Studio Micro-Kernel and Plugin Boundary | Accepted | 2026-03-07 |
| [018](ADR-018-capability-contracts-and-observability-gates.md) | Capability Contracts and Observability Gates (+ Transitive Escalation Prevention) | Accepted | 2026-03-07 |
| [019](ADR-019-npm-scope-and-namespace-strategy.md) | npm Scope and Namespace Strategy (@refarm.dev) | Accepted | 2026-03-07 |
| [025](ADR-025-pure-microkernel-architecture.md) | Pure Microkernel Architecture for Tractor | Proposed | 2026-03-07 |
| [026](ADR-026-externalized-storage-migrations.md) | Externalized Storage Migrations | Proposed | 2026-03-08 |
| [027](ADR-027-compositional-plugin-architecture.md) | Compositional Plugin Architecture | Proposed | 2026-03-08 |
| [028](ADR-028-crdt-sqlite-convergence-strategy.md) | CRDT-SQLite Convergence Strategy | Proposed | 2026-03-08 |
| [029](ADR-029-native-browser-permissions-as-capabilities.md) | Native Browser Permissions as Capabilities | Proposed | 2026-03-08 |
| [030](ADR-030-devops-in-grand-style.md) | DevOps in Grand Style | Proposed | 2026-03-08 |
| [031](ADR-031-pluggable-relational-storage.md) | Pluggable Relational Storage | Proposed | 2026-03-09 |
| [032](ADR-032-proton-security-mandatory-signing.md) | Proton Security - Mandatory Signing | Proposed | 2026-03-09 |
| [033](ADR-033-command-governance.md) | Command Governance | Proposed | 2026-03-09 |
| [034](ADR-034-identity-adoption-conversion.md) | Identity Adoption Conversion | Proposed | 2026-03-10 |
| [035](ADR-035-device-verification-cross-signing.md) | Device Verification & Cross-Signing | Proposed | 2026-03-10 |
| [036](ADR-036-sovereign-bootloader-and-strict-ssg.md) | Sovereign Bootloader and Strict SSG | Accepted | 2026-03-11 |
| [037](ADR-037-infrastructure-escalation-strategy.md) | Infrastructure Escalation Strategy | Accepted | 2026-03-12 |
| [040](ADR-040-sovereign-infrastructure-as-graph.md) | Sovereign Infrastructure as a Graph | Proposed | 2026-03-13 |
| [041](ADR-041-sovereign-environments-isolation.md) | Sovereign Environments Isolation | Proposed | 2026-03-13 |
| [042](ADR-042-homestead-modularization.md) | Homestead Modularization | Proposed | 2026-03-14 |
| [043](ADR-043-radical-dogfooding-and-eac.md) | Radical Dogfooding and Extreme Autonomy | Proposed | 2026-03-14 |
| [044](ADR-044-wasm-plugin-loading-browser-strategy.md) | WASM Plugin Loading Browser Strategy | Accepted | 2026-03-15 |
| [045](ADR-045-loro-crdt-adoption.md) | Loro CRDT Adoption | Accepted | 2026-03-17 |
| [046](ADR-046-refarm-composition-model.md) | Refarm Composition Model (Blocks and Distros) | Accepted | 2026-03-17 |

## Planned (Future ADRs)

---

## Under Design (Requires Implementation + Tests Before Acceptance)

These ADRs define architecture direction but are NOT executable contracts yet. Sprint 2+ implementation required.

| ADR | Title | Status | Target | Blockers |
|-----|-------|--------|--------|----------|
| [020](ADR-020-sovereign-graph-versioning.md) | Sovereign Graph Versioning (commit/branch/checkout/revert) | ✏️ Proposed | v0.2.0-0.3.0 | 30+ invariant tests + kernel implementation |
| [021](ADR-021-self-healing-and-plugin-citizenship.md) | Self-Healing & Plugin Citizenship Monitoring | ✏️ Proposed | v0.3.0+ | 40+ integration tests + kernel implementation |
| [022](ADR-022-policy-declarations-in-plugin-manifests.md) | Policy Declarations in Plugin Manifests (+ Performance Budgets) | ✏️ Proposed | v0.3.0+ | Manifest schema + PolicyManager + PerformanceMonitor implementation |
| [023](ADR-023-plugin-conflict-detection.md) | Plugin Conflict Detection and Resolution | ✏️ Proposed | v0.2.0-0.3.0 | ConflictDetector + GraphMonitor + UI implementation |
| [024](ADR-024-pessimistic-editing-modes.md) | Pessimistic Editing Modes (Locks via Private Branches) | ✏️ Proposed | v0.3.0+ | LockManager + UI patterns + merge strategies implementation |

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

| ADR | Title | Superseded By | Reason |
|-----|-------|---------------|--------|
| [003](ADR-003-crdt-synchronization.md) | CRDT Choice (Yjs) | [045](ADR-045-loro-crdt-adoption.md) | Adoption of Loro CRDT for better cycle-safe tracking, snapshot support, and a unified Rust-core. |

---

## How to Create an ADR

1. Copy [template.md](template.md)
2. Rename to `ADR-XXX-brief-title.md`
3. Fill in all sections
4. Submit for review
5. Update this index when accepted
