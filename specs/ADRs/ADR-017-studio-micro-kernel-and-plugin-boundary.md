# ADR-017: Studio Micro-Kernel and Plugin Boundary

**Status**: Accepted  
**Date**: 2026-03-07  
**Deciders**: Refarm core maintainers  
**Related**: ADR-002, ADR-007, ADR-008, ADR-009, ADR-016

---

## Context

Refarm targets a powerhouse platform with:

- high composability across features
- third-party plugin ecosystem
- replaceable implementations for critical capabilities
- strict observability from day 1

Current repository structure already separates core primitives into packages (`storage-sqlite`, `sync-crdt`, `identity-nostr`), but without a hard architectural decision on what belongs to Studio core versus plugins.

Without this boundary now, future ecosystem growth risks lock-in, inconsistent extension points, and expensive migration.

---

## Decision

**We will adopt a micro-kernel architecture for `apps/studio`, where core is minimal and all business capabilities are plugins.**

### Core (non-plugin, irredutible)

`apps/studio` core owns only:

1. plugin loader lifecycle
2. capability registry and permission checks
3. message bus for inter-plugin communication
4. sandbox boundaries and isolation controls
5. observability pipeline and event ingestion
6. minimal UI shell/slots to host plugin UI

### Plugins (all domain behavior)

Domain capabilities MUST be implemented as plugins, including:

- storage (`storage:v1`, OPFS + SQLite or alternatives)
- sync
- identity
- import/export
- feature modules

---

## Alternatives Considered

### Option 1: Studio monolith with optional plugins

**Pros:**

- simple bootstrap
- low architectural overhead initially

**Cons:**

- weak ecosystem replaceability
- domain logic coupled to app
- expensive future migration

### Option 2: Hybrid with non-replaceable core domain services

**Pros:**

- practical early delivery
- lower runtime complexity

**Cons:**

- partial lock-in in strategic areas (storage/sync/identity)
- ambiguous extension contracts

### Chosen: Option 3 (Micro-kernel + plugin-first)

**Rationale**: aligns with third-party strategy, preserves options, and supports composability as a first-class property.

---

## Consequences

**Positive:**

- replaceable implementations for strategic capabilities
- stronger third-party ecosystem path
- cleaner boundaries for testing and maintenance
- future-proof architecture for composable distributions

**Negative:**

- added complexity in dependency/version management
- tighter requirements for plugin contracts and SDKs
- increased need for robust observability and policy gates

**Risks:**

- bootstrap/runtime complexity growth (mitigation: strict core scope and staged rollout)
- plugin incompatibility over time (mitigation: semver + capability versioning)
- degraded UX from plugin failures (mitigation: isolation and circuit breakers)

---

## Implementation

**Affected components:**

- `apps/studio` (kernel responsibilities)
- `packages/*` plugin-oriented capability packages
- `specs/` for capability contracts and conformance

**Migration path:**

1. define formal capability contracts (starting with `storage:v1`)
2. implement conformance suite and quality gates
3. adapt internal providers to capability interface
4. expose plugin SDK for third parties

**Timeline:** starts in v0.1.x foundation phase.

---

## References

- [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
- [docs/DEVOPS.md](../../docs/DEVOPS.md)
- [Component Model](https://component-model.bytecodealliance.org/)
