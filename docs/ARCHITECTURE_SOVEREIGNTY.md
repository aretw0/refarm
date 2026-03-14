# Refarm Architecture: User Sovereignty by Design

**Purpose**: Visual guide from low-level details to high-level philosophy. Why every decision protects user ownership.

---

## The Problem We're Solving

```
User downloads Refarm, creates 1000 offline notes.
Then...

Scenario A: Plugin breaks → entire graph becomes inaccessible
Scenario B: Schema upgrade fails → old data becomes unparseable
Scenario C: Two devices sync with different versions → conflicts nowhere to resolve
Scenario D: User wants to undo a mistake from 3 weeks ago → impossible

Result: User loses trust in system. Loses data. Leaves.
```

Our commitment: **None of these scenarios happen.**

---

## Architecture: Five Layers (Low to High)

### Layer 0: Persistence (The Ground Truth)

![Layer 0: Persistence](./diagrams/sovereignty-l0.svg)
[View source](file:///workspaces/refarm/docs/diagrams/sovereignty-l0.mermaid)

**Invariant**: Everything checksummed, nothing can silently corrupt.

---

### Layer 1: Storage & CRDT Self-Healing (ADR-021, Part 1)

![Layer 1: Self-Healing](./diagrams/sovereignty-l1.svg)
[View source](file:///workspaces/refarm/docs/diagrams/sovereignty-l1.mermaid)

**Key guarantees**:

- ✅ Corruption detected immediately
- ✅ Recovery automatic (no user intervention)
- ✅ Fallback graceful (salvage what's possible)

---

### Layer 2: Pluggable Storage & Migration Resilience (ADR-023/031)

![Layer 2: Pluggable Storage](./diagrams/sovereignty-l2.svg)
[View source](file:///workspaces/refarm/docs/diagrams/sovereignty-l2.mermaid)

**Key guarantees**:

- ✅ **Engine-Agnostic**: User can switch storage engines (e.g., to PGLite for AI features) without losing history.
- ✅ **Bidirectional Sync**: Old clients can often "see" through new data via lens projections.
- ✅ **Op-Log Integrity**: The underlying CRDT log (Layer 0) remains the source of truth, regardless of the materialized view in SQLite/Postgres.
- ✅ **Graceful Transition**: No "flag days" for schema changes. Peers converge lazily.

---

### Layer 3: Graph Versioning & Reversibility (ADR-020)

![Layer 3: Graph Versioning](./diagrams/sovereignty-l3.svg)
[View source](file:///workspaces/refarm/docs/diagrams/sovereignty-l3.mermaid)

**Key guarantees**:

- ✅ User can experiment (branch), then revert safely
- ✅ History immutable (audit trail)
- ✅ Revertable across offline edits + multi-device sync
- ✅ Causality preserved (no hidden history)

---

### Layer 4: Plugin Citizenship & Monitoring (ADR-021, Part 2)

![Layer 4: Plugin Citizenship](./diagrams/sovereignty-l4.svg)
[View source](file:///workspaces/refarm/docs/diagrams/sovereignty-l4.mermaid)

**Key guarantees**:

- ✅ Plugin misbehavior detected in real-time
- ✅ Automatic isolation before system-wide failure
- ✅ User sees via Dashboard what's happening
- ✅ No silent data corruption from plugins

---

### Layer 5: User Sovereignty (Philosophy)

![Layer 5: Philosophy](./diagrams/sovereignty-l5.svg)
[View source](file:///workspaces/refarm/docs/diagrams/sovereignty-l5.mermaid)

---

### Layer 6: Infrastructure Sovereignty (ADR-043)

**Key guarantees**:

- ✅ **Everything as Config (EaC)**: The project is its own dogfood representation — zero hardcoded dependencies in CI/CD.
- ✅ **Decoupled Providers**: Abstracted "Provider Bridges" (Git/DNS) prevent platform lock-in.
- ✅ **Kill Switch (Escape Hatch)**: A one-click automated migration pipeline to move the entire project (Repo + DNS + Meta) to another host.
- ✅ **Radical Portability**: Infrastructure state travels with the project's config, just like user data.

**Technical Implementation: Strategic Bootstrap**

The "Sovereignty of Infrastructure" is achieved through a dynamic configuration engine that detects **intent** before consolidation:

1. **Intent Detection**: The system identifies the activation mode (`Static`, `Persistent`, or `Ephemeral`) based on repository signals or environment overrides.
2. **Pluggable Sources**: Config is unified from multiple sources (`JsonSource`, `EnvSource`, `RemoteGraphSource`) with dynamic precedence.
3. **Active Sovereignty**: In `Persistent` mode, the project derives its entire infrastructure state from a Sovereign Graph 24/7, enabling real-time infrastructure auto-healing and migration.

---

## How These Layers Interact: Example Scenario

### Scenario: User Upgrades App While Offline

**State Before**:

- Device has v0.1.0 app + notes in schema v0
- Device goes offline
- App gets automatically upgraded to v0.2.0 (new schema v1)

**Execution**:

```
1. User opens app (v0.2.0)
   ↓
2. Tractor boots:
   Layer 1: Checks WAL + CRDT snapshot
            ✅ No corruption, checksums pass
   ↓
3. User opens old note (created in v0.1.0)
   ↓
   Layer 2: Detects @context = "v0"
            Applies migration lens: add tags: []
            ✅ Upcasted to v1
   ↓
4. User edits note
   ↓
   Layer 3: Creates commit "Edited Q1 notes"
            (Builds Merkle DAG, parent = last commit)
   ↓
5. Plugin starts using new fields
   ↓
   Layer 4: Monitor tracks plugin CPU/memory
            Still healthy
   ↓
6. User realizes mistake, reverts edits
   ↓
   Layer 3: Creates compensating commit
            (No deletion, just undo operations)
            Merkle DAG: old ← new → revert-commit
   ↓
7. (Optional) User goes online
   ↓
   Layer 0 + 3: CRDT merges with device B
               Revert commit syncs too
               Both converge to same state
               ✅ Multi-device safe
```

**User outcome**: "Everything just worked. I can trust this system."

---

## Design Decisions: Why This Architecture?

| Principle | Implementation |
|-----------|-----------------|
| **Offline Sovereignty** | No central authority; all logic client-side (tractor) |
| **Reversibility** | Every operation logged; revert creates compensating ops (never deletes) |
| **Transparency** | Full history queryable; causality preserved; commit authors tracked |
| **Self-Healing** | Corruption detected + auto-repaired; schema mismatches handled gracefully |
| **Isolation** | Plugins monitored per-operation; bad actors throttled before system breaks |
| **Compatibility** | Schema evolution via lenses; old data always readable; gradual migration |
| **Composability** | Plugins pluggable via micro-tractor; standard capability contracts |

---

## Related ADRs

| ADR | Role in Sovereignty |
|-----|-------------------|
| [ADR-002](../specs/ADRs/ADR-002-offline-first-architecture.md) | Offline foundation (no central authority) |
| [ADR-003](../specs/ADRs/ADR-003-crdt-synchronization.md) | CRDT engine for automatic conflict resolution |
| [ADR-010](../specs/ADRs/ADR-010-schema-evolution.md) | Schema compatibility (old data always works) |
| [ADR-017](../specs/ADRs/ADR-017-studio-micro-tractor-and-plugin-boundary.md) | Micro-tractor for plugin isolation |
| [ADR-020](../specs/ADRs/ADR-020-sovereign-graph-versioning.md) | **NEW**: User-facing versioning (commit/branch/revert) |
| [ADR-021](../specs/ADRs/ADR-021-self-healing-and-plugin-citizenship.md) | **NEW**: Self-healing + plugin monitoring |

---

## Testing Strategy: Proof That It Works

Each layer must pass invariant tests **before v1.0.0**:

```
Layer 1 (Storage): "Can recover from corruption"
Layer 2 (Schema): "Old data upgradeable to new schema"
Layer 3 (Versioning): "Revert is reproducible and sync-safe"
Layer 4 (Plugins): "Bad plugin is isolated before system breaks"
Layer 5 (Integration): "All 4 layers work together across multi-device scenario"
```

See [ADR-020](../specs/ADRs/ADR-020-sovereign-graph-versioning.md#testing-strategy-invariants) and [ADR-021](../specs/ADRs/ADR-021-self-healing-and-plugin-citizenship.md#testing-strategy) for detailed test specs.

---

## Open Questions for Discussion

1. **UI complexity**: How much health detail should we expose to non-technical users?
2. **Recovery policies**: Auto-isolate plugins vs. ask user first?
3. **Data export**: Should users be able to export full history or only current state?
4. **Compression**: How to make very long histories (10k commits) performant?
5. **Cross-device healing**: If Device A detects corruption, should it proactively heal Device B?

---

## Bottom Line

Refarm is **not** a cloud app that "syncs to the cloud." It's a **sovereign system** where:

- **You own your data** (it lives on your devices only)
- **You control the history** (can version, branch, revert)
- **You decide the rules** (plugins you trust, quotas you set)
- **The system heals itself** (corruption caught and repaired automatically)
- **Nothing is silent** (all changes auditable, all failures visible)

This is what "offline-first" really means.
