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

```
┌─────────────────────────────────────┐
│  User's Device (Browser + OPFS)     │
│                                     │
│  ┌─────────────────────────────────┐
│  │       SQLite Database           │
│  │  (JSON-LD nodes + metadata)     │
│  │  - One node = one row           │
│  │  - Checksum per row (detect     │
│  │    corruption)                  │
│  └─────────────────────────────────┘
│                                     │
│  ┌─────────────────────────────────┐
│  │    IndexedDB (CRDT State)       │
│  │  - Yjs document encoded         │
│  │  - Write-ahead log              │
│  │  - Snapshots for fast restore   │
│  └─────────────────────────────────┘
│                                     │
│  ┌─────────────────────────────────┐
│  │   Versioning Commits (Log)      │
│  │  - Content-addressed by hash    │
│  │  - Immutable (never modified)   │
│  │  - Parent chaining (causal)     │
│  └─────────────────────────────────┘
└─────────────────────────────────────┘
```

**Invariant**: Everything checksummed, nothing can silently corrupt.

---

### Layer 1: Storage & CRDT Self-Healing (ADR-021, Part 1)

```
┌────────────────────────────────────────────┐
│  Kernel: Storage Integrity Checks          │
│                                            │
│  On every read:                            │
│  ┌────────────────────────────────────┐   │
│  │ 1. Fetch from SQLite/IndexedDB     │   │
│  │ 2. Verify checksum                 │   │
│  │ 3. If mismatch → attempt recovery  │   │
│  │    - Fallback to Write-Ahead Log   │   │
│  │    - Downshift schema version       │   │
│  │    - Salvage what's readable        │   │
│  └────────────────────────────────────┘   │
│                                            │
│  On every write:                           │
│  ┌────────────────────────────────────┐   │
│  │ 1. Compute + store checksum        │   │
│  │ 2. Log to WAL before commit        │   │
│  │ 3. Atomic append                   │   │
│  │ 4. Verify write succeeded          │   │
│  └────────────────────────────────────┘   │
│                                            │
│  Result: Storage layer can heal itself     │
│  from corruption OR data loss.             │
└────────────────────────────────────────────┘
```

**Key guarantees**:
- ✅ Corruption detected immediately
- ✅ Recovery automatic (no user intervention)
- ✅ Fallback graceful (salvage what's possible)

---

### Layer 2: Schema & Migration Resilience (ADR-010 Integrated)

```
┌──────────────────────────────────────────────────────┐
│  Kernel: Schema Evolution Management                 │
│                                                      │
│  Old data v0 → Current version vN                   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │ When app reads old node:                     │   │
│  │                                              │   │
│  │ 1. Detect schema version from @context      │   │
│  │ 2. If old: apply migration lenses            │   │
│  │    - v0 → v1: add tags: [] (default)        │   │
│  │    - v1 → v2: add timestamps (infer)        │   │
│  │    - etc.                                   │   │
│  │ 3. If migration fails:                       │   │
│  │    - Try downgrading (use v0 view)          │   │
│  │    - If all fails: salvage structure         │   │
│  │ 4. Persist upgraded version going forward   │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  Result: User never sees "incompatible format"     │
│  error or data loss from upgrades.                 │
└──────────────────────────────────────────────────────┘
```

**Key guarantees**:
- ✅ Old data always readable (even if app version leaps)
- ✅ Gradual migration (not required upfront)
- ✅ Rollback safe (old schema version accessible)

---

### Layer 3: Graph Versioning & Reversibility (ADR-020)

```
┌─────────────────────────────────────────────────────────┐
│  Kernel: Sovereign Graph Versioning                     │
│                                                         │
│  4 User-Facing Primitives:                              │
│                                                         │
│  1. COMMIT                                              │
│     └─ kernel.graph.commit({ message: "..." })         │
│        Creates immutable snapshot + point-in-time audit │
│        ↓                                                 │
│        Merkle DAG:                                      │
│        main:  A ← B ← C (HEAD)                         │
│        draft: B ← D ← E (alternative history)          │
│                                                         │
│  2. BRANCH                                              │
│     └─ kernel.graph.branch("main" | "draft/exp")       │
│        Create parallel work streams                     │
│        Both are local (offline-first)                  │
│        Each has own commit history                     │
│                                                         │
│  3. CHECKOUT                                            │
│     └─ kernel.graph.checkout("draft/exp")              │
│        Restore CRDT state from commit                   │
│        Working graph = exactly that snapshot            │
│        Reproducible (same commit → same state)         │
│                                                         │
│  4. REVERT                                              │
│     └─ kernel.graph.revert("commitHash")               │
│        Creates inverse operations (no deletion!)        │
│        Preserves auditability                           │
│        Safe for multi-device sync                       │
│                                                         │
│  Philosophy: Git-like UX for user data                 │
│  but CRDT-native (conflicts merge automatically)       │
└─────────────────────────────────────────────────────────┘
```

**Key guarantees**:
- ✅ User can experiment (branch), then revert safely
- ✅ History immutable (audit trail)
- ✅ Revertable across offline edits + multi-device sync
- ✅ Causality preserved (no hidden history)

---

### Layer 4: Plugin Citizenship & Monitoring (ADR-021, Part 2)

```
┌──────────────────────────────────────────────────────────┐
│  Kernel: Plugin Health & Isolation                      │
│                                                          │
│  Each plugin gets a "Citizenship Score":                │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  PluginCitizen {                                   │  │
│  │    id: "storage:v1"                               │  │
│  │    state: "healthy" | "degraded" | "isolated"    │  │
│  │    healthScore: 95/100                             │  │
│  │    memoryUsage: 32MB / 64MB quota                 │  │
│  │    errorRate: 0.1%                                 │  │
│  │    lastHealthCheckAt: timestamp                    │  │
│  │  }                                                  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  Every plugin operation measured:                       │
│  ┌────────────────────────────────────────────────────┐  │
│  │  kernel.executeCapability(                         │  │
│  │    pluginId: "storage:v1",                        │  │
│  │    method: "store",                               │  │
│  │    args: [...]                                     │  │
│  │  )                                                  │  │
│  │                                                    │  │
│  │  ↓ (kernel wraps execution)                        │  │
│  │                                                    │  │
│  │  1. Record start time + memory                    │  │
│  │  2. Execute plugin code                           │  │
│  │  3. Catch errors                                  │  │
│  │  4. Report to CitizenshipMonitor                 │  │
│  │     - duration, memory delta, success/fail        │  │
│  │  5. Update health score (rules engine)            │  │
│  │  6. If degraded/isolated → event to Observability│  │
│  │                                                    │  │
│  │  ↓ (state transitions)                             │  │
│  │                                                    │  │
│  │  healthy (score 80-100)                           │  │
│  │    ↓                                               │  │
│  │  degraded (score 50-79)                           │  │
│  │    └─ reduce quotas (50% memory, 50% I/O)        │  │
│  │    └─ increase monitoring frequency                │  │
│  │    ↓                                               │  │
│  │  isolated (score <50)                             │  │
│  │    └─ severe throttling (10% quota)               │  │
│  │    └─ block risky operations                      │  │
│  │    ↓                                               │  │
│  │  quarantined (extreme cases)                      │  │
│  │    └─ disable plugin entirely                     │  │
│  │    └─ preserve system integrity                   │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  Result: Bad plugin cannot crash entire system.         │
│  Kernel detects + isolates before damage spreads.       │
└──────────────────────────────────────────────────────────┘
```

**Key guarantees**:
- ✅ Plugin misbehavior detected in real-time
- ✅ Automatic isolation before system-wide failure
- ✅ User sees via Dashboard what's happening
- ✅ No silent data corruption from plugins

---

### Layer 5: User Sovereignty (Philosophy)

```
┌────────────────────────────────────────────────────────┐
│  User Experience: What You Own, You Control            │
│                                                        │
│  Studio UI shows:                                      │
│  ┌──────────────────────────────────────────────────┐  │
│  │ [Graph Versioning]          [Plugin Health]      │  │
│  │ • main (HEAD: Commit C)      ✅ storage:v1 (95)  │  │
│  │ • draft/q1-planning          ⚠️  sync:v1 (60)    │  │
│  │ • archive/2024 (collapsed)   ❌ ui-plugin (20)   │  │
│  │ • [+ Commit]                 [Isolate]           │  │
│  │                                                  │  │
│  │ [Recent History]             [Recovery Options] │  │
│  │ • [C] "Q1 complete" (now)    • Revert to C-1    │  │
│  │ • [B] "Q1 draft" (-3 days)   • Checkout branch  │  │
│  │ • [A] "Initial" (-1 week)    • Export data      │  │
│  │                                                  │  │
│  │ [Data Health]                                    │  │
│  │ • Corruption checks: ✅ passed                   │  │
│  │ • Schema compatibility: ✅ all upgradeable       │  │
│  │ • Plugin isolation: ⚠️ 1 plugin throttled       │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  User Can:                                            │
│  • Experiment → branch("experiment")                  │
│  • Make mistakes → revert safely                      │
│  • Use multiple devices → automatic merge             │
│  • Upgrade app → old data still works                 │
│  • Audit changes → full history + author             │
│  • Disable bad plugins → without losing data         │
│  • Export everything → full ownership                │
│                                                        │
│  System Guarantees:                                   │
│  ✅ Never silent data loss                           │
│  ✅ Always recoverable (back N commits)              │
│  ✅ Never locked in (full export, open formats)      │
│  ✅ Always auditable (who did what when)             │
│  ✅ Always safe (corruption caught + repaired)       │
└────────────────────────────────────────────────────────┘
```

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
2. Kernel boots:
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
| **Offline Sovereignty** | No central authority; all logic client-side (kernel) |
| **Reversibility** | Every operation logged; revert creates compensating ops (never deletes) |
| **Transparency** | Full history queryable; causality preserved; commit authors tracked |
| **Self-Healing** | Corruption detected + auto-repaired; schema mismatches handled gracefully |
| **Isolation** | Plugins monitored per-operation; bad actors throttled before system breaks |
| **Compatibility** | Schema evolution via lenses; old data always readable; gradual migration |
| **Composability** | Plugins pluggable via micro-kernel; standard capability contracts |

---

## Related ADRs

| ADR | Role in Sovereignty |
|-----|-------------------|
| [ADR-002](../specs/ADRs/ADR-002-offline-first-architecture.md) | Offline foundation (no central authority) |
| [ADR-003](../specs/ADRs/ADR-003-crdt-synchronization.md) | CRDT engine for automatic conflict resolution |
| [ADR-010](../specs/ADRs/ADR-010-schema-evolution.md) | Schema compatibility (old data always works) |
| [ADR-017](../specs/ADRs/ADR-017-studio-micro-kernel-and-plugin-boundary.md) | Micro-kernel for plugin isolation |
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
