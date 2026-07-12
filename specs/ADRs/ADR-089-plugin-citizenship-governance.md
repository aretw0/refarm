# ADR-089: Plugin Citizenship & Governance (Umbrella Index)

**Status**: Proposed  
**Progress**: Index only — the child ADRs remain the executable specs; each is independently tracked  
**Date**: 2026-07-12  
**Deciders**: Arthur Silva, Claude  
**Related**: [ADR-017](ADR-017-studio-micro-kernel-and-plugin-boundary.md), [ADR-018](ADR-018-capability-contracts-and-observability-gates.md), [ADR-020](ADR-020-sovereign-graph-versioning.md), [ADR-021](ADR-021-self-healing-and-plugin-citizenship.md), [ADR-022](ADR-022-policy-declarations-in-plugin-manifests.md), [ADR-023](ADR-023-plugin-conflict-detection.md), [ADR-024](ADR-024-pessimistic-editing-modes.md)

---

## Context

Five "Direction-Setting" ADRs from 2026-03-07 describe how a plugin becomes a
well-behaved citizen of the runtime: how its edits are versioned and reverted, how
the host watches its health, how it declares the policies it obeys, how conflicting
plugins are detected, and how a plugin takes a pessimistic lock. They sit together
under ADR-017 (micro-kernel boundary) + ADR-018 (capability contracts), share the
same "not yet executable — kernel work + 30–40 tests required" status, and are
listed as a block in the README's *Under Design* section.

Read one at a time they are hard to place; there was no single entry that says
"here is the plugin-citizenship story and which ADR owns each mechanism."

## Decision

**This ADR is an INDEX, not a new decision — and deliberately not a merge.**

The five child ADRs describe *technically distinct mechanisms* (a `LockManager` is
not a `ConflictDetector` is not a `PolicyManager` is not the self-healing monitor is
not graph versioning), each with its own blockers and its own implementation
sprint. Collapsing them into one document would erase that per-mechanism
traceability. So they stay as separate, independently-tracked ADRs; this umbrella
only gives them a shared front door and states the common frame.

**Common frame:** a plugin is a *citizen* — it operates with least privilege inside
the micro-kernel (ADR-017), its host-effects are gated by capability contracts
(ADR-018), and citizenship adds the runtime's side of the contract: version &
revert its work, watch its health, hold it to its declared policies, detect when it
collides with another, and let it lock what it must edit exclusively.

## The mechanisms (each owned by its child ADR)

| Concern | ADR | Mechanism | Status / blocker |
| --- | --- | --- | --- |
| Version & revert a plugin's graph edits | [020](ADR-020-sovereign-graph-versioning.md) | commit / branch / checkout / revert over the sovereign graph | Proposed — 30+ invariant tests + kernel |
| Watch plugin health & recover | [021](ADR-021-self-healing-and-plugin-citizenship.md) | citizenship monitoring + self-healing | Proposed — 40+ integration tests + kernel |
| Hold a plugin to declared policies | [022](ADR-022-policy-declarations-in-plugin-manifests.md) | manifest policy declarations + performance budgets (`PolicyManager`, `PerformanceMonitor`) | Proposed — manifest schema + managers |
| Detect colliding plugins | [023](ADR-023-plugin-conflict-detection.md) | `ConflictDetector` + `GraphMonitor` | Proposed — detector + UI |
| Exclusive editing | [024](ADR-024-pessimistic-editing-modes.md) | pessimistic locks via private branches (builds on ADR-020) | Proposed — `LockManager` + merge strategies |

## Non-goals

- Do NOT merge the child ADRs — the per-mechanism blockers and sprints are the
  point; this index preserves them.
- Do NOT change any child decision — this ADR adds no new architecture, only a map.
- Do not treat this as accepted governance: the mechanisms remain Proposed until
  their own tests + kernel work land.

## Consequences

A reader (or an agent) landing on plugin governance has one entry that names every
mechanism and points at the owning ADR + its blocker, instead of five files to
reconstruct the shape from. Each child ADR gains a `Related: ADR-089` back-pointer
so the cluster is navigable in both directions. The *Under Design* README section
can now reference this umbrella as the cluster's front door.
