# ADR-020: Sovereign Graph Versioning

**Status**: Proposed  
**Date**: 2026-03-07  
**Deciders**: Core Team  
**Related**: ADR-002 (Offline-first), ADR-003 (CRDT), ADR-010 (Schema Evolution), ADR-017 (Micro-kernel)

---

## Context

Users deserve full ownership and reversibility of their data. With offline-first architecture, data lives on user devices — they must be able to:

1. **Experiment safely**: Create branches, try changes, revert without losing history
2. **Understand causality**: See "who changed what when" across offline edits
3. **Migrate safely**: Move between Refarm versions without losing semantics
4. **Audit accountability**: Link changes to identity (author, device, intention)

Without explicit versioning, users face:
- *"I made a mistake 3 days ago but can only see today's state"*
- *"My two devices have different data and I can't merge them back"*
- *"Did the schema upgrade break my old data silently?"*

**Current state**: CRDT provides causal history but no user-facing version control. Schema evolution (ADR-010) handles compatibility but not reversibility. No branch/revert semantics.

---

## Decision

**Implement Sovereign Graph Versioning with 4 invariant-testable primitives: `commit`, `branch`, `checkout`, `revert`.**

This is **foundational, not post-MVP**. Before `1.0.0`, all 4 primitives must satisfy invariants below.

### Primitive 1: Commit (Immutable Snapshot)

```typescript
interface Commit {
  id: string;                    // Deterministic hash
  parent: Commit | null;         // Causal link
  timestamp: number;             // ISO 8601
  author: DID;                   // Identity (nostr, did:key, etc)
  message: string;               // User intent
  crdtSnapshot: Uint8Array;      // Yjs encoded state
  metadata: {
    device?: string;
    schema?: string;             // e.g., "@context": v1
    tags?: string[];             // User-defined labels
  };
}

kernel.graph.commit({
  message: "Q1 planning complete",
  tags: ["milestone/q1", "archive"]
});
// → Commit { id: "sha256...", parent: previousCommit, ... }
```

**Properties**:
- Immutable (never modify, only create new)
- Hash includes content + parent (prevents tampering)
- Captures CRDT state point-in-time (full snapshot, not delta)
- Deterministic (same content = same ID)

### Primitive 2: Branch (Mutable Ref)

```typescript
interface Branch {
  name: string;
  headCommit: Commit;
  upstream?: Branch;             // For sync with other devices
  local: boolean;                // Only exists locally vs. synced
}

kernel.graph.branch("main");
kernel.graph.branch("draft/experiment");
kernel.graph.branch.list();
// → ["main", "draft/experiment"]

kernel.graph.branch.current();
// → "main"
```

**Properties**:
- Mutable pointer to a Commit
- Created offline-first (no central registry)
- Can have local and synced variants
- Enables simultaneous work streams

### Primitive 3: Checkout (Materialize State)

```typescript
kernel.graph.checkout("draft/experiment");
// Restores CRDT state from that commit

kernel.graph.status();
// → WorkingGraph { branch: "draft/experiment", 
//     isDirty: false, 
//     headCommit: ... }

// Edit some data (CRDT records changes)

kernel.graph.status();
// → WorkingGraph { branch: "draft/experiment", 
//     isDirty: true, 
//     uncommittedChanges: [...] }
```

**Properties**:
- Changes working CRDT state
- Preserves dirty state (uncommitted changes) per branch
- Reproducible: `checkout(X)` always yields same state

### Primitive 4: Revert (Compensating Commit)

```typescript
// Find a past commit where task.status was correct
const goodCommit = kernel.graph.log({ filter: "task-id:123" })[0];

// Create new commit with compensating changes
kernel.graph.revert(goodCommit.id);
// → New commit that undoes changes since goodCommit
//   (doesn't delete history, creates inverse operations)

kernel.graph.log();
// → [
//     { id: "new-revert-X", message: "Revert to <goodCommit>" },
//     { id: "badCommit-2", message: "Oops" },
//     { id: "badCommit-1", message: "Also bad" },
//     { id: "goodCommit", message: "Last known good" }
//   ]
```

**Properties**:
- Creates inverse operations, doesn't delete
- Preserves auditability (no hidden history)
- Safe for multi-device: revert operations sync like any other
- Enables bisection for debugging

---

## Invariants (Non-Negotiable Before 1.0.0)

### Invariant 1: Reproducibility

```typescript
// Any two checkouts of same commit must yield identical graph state
const state1 = await kernel.graph.checkout("c123");
const graph1 = kernel.graph.export();

const state2 = await kernel.graph.checkout("c456");
const state3 = await kernel.graph.checkout("c123");
const graph3 = kernel.graph.export();

expect(graph1).toEqual(graph3);  // ✅ MUST pass
```

**Test**: Load same commit 100 times from different devices, verify bit-for-bit CRDT equality.

### Invariant 2: Causal Consistency

```typescript
// Commit history reflects actual causality
const log = kernel.graph.log();

for (let i = 1; i < log.length; i++) {
  expect(log[i].parent).toBe(log[i-1].id);  // Chain unbroken
  expect(log[i].timestamp >= log[i-1].timestamp);  // Monotonic
}
```

**Test**: Across offline edits on 3 devices, verify merged log respects causality.

### Invariant 3: Sync Safety (Critical)

```typescript
// Revert operations must not break multi-device convergence
// Device A: commits X → Y → Z
// Device B: commits X → Y (offline)
// Device A: reverts Y (creates new commit R)

// When B syncs: must converge to same state
// and preserve causality (X → Y ← Z ← R)

// Test: execute revert while peers are offline, verify convergence
```

**Test**: 3-device scenario with concurrent work + revert, verify CRDT convergence to stable state.

### Invariant 4: Schema Continuity

```typescript
// Old commits (v0 schema) must remain queryable after schema upgrade
const oldCommit = kernel.graph.getCommit("schema-v0-commit-id");
kernel.graph.checkout(oldCommit.id);

// Even though app now uses v1 schema, old data accessible
const node = kernel.graph.getNode("task-123");
expect(node.tags).toBeDefined();  // Upcasted via ADR-010
```

**Test**: Create commit in v0 schema, upgrade app to v1, checkout old commit, verify upcasting.

### Invariant 5: Performance under History

```typescript
// Commit log must not degrade checkout performance
// Whether history is 10 or 10,000 commits

const t0 = performance.now();
await kernel.graph.checkout("commit-10000");
const t1 = performance.now();

expect(t1 - t0).toBeLessThan(100);  // ms, not seconds
```

**Test**: Generate 10k commits, measure checkout latency.

---

## Implementation: Layers

### Layer 1: Storage (CRDT + Tombstones)

```typescript
// packages/sync-crdt/src/versioning/version-store.ts

interface VersionedDocument {
  id: string;
  content: Uint8Array;        // Yjs encoded state
  commitId: string;
  timestamp: number;
  metadata: object;
}

class VersionStore {
  /**
   * Store: Save CRDT state with commit metadata
   * Where: IndexedDB + OPFS for long-term
   */
  async storeCommit(commit: Commit, crdtState: Uint8Array) {
    await this.db.put('commits', {
      id: commit.id,
      parent: commit.parent?.id,
      timestamp: commit.timestamp,
      author: commit.author,
      message: commit.message,
      crdtSnapshot: crdtState,
      metadata: commit.metadata
    });
    
    // Update branch pointer atomically
    await this.db.put('refs', {
      branch: "main",
      headCommit: commit.id
    });
  }

  /**
   * Retrieve: Load CRDT state from commit
   * Verify: Hash check (content-addressable)
   */
  async loadCommit(commitId: string): Promise<{ crdt: Uint8Array, commit: Commit }> {
    const stored = await this.db.get('commits', commitId);
    
    // Verify integrity
    const computedHash = this.hashCommit(stored);
    if (computedHash !== commitId) {
      throw new Error(`Commit ${commitId} failed hash check (corruption)`);
    }
    
    return {
      crdt: stored.crdtSnapshot,
      commit: stored
    };
  }

  /**
   * Revert: Store inverse operations (new commit, not deletion)
   */
  async storeRevert(
    targetCommit: Commit,
    currentState: Uint8Array
  ): Promise<Commit> {
    // Compute inverse diff: currentState → targetCommit.state
    const targetState = await this.loadCommit(targetCommit.id);
    const inverseDiff = computeInverseDiff(currentState, targetState.crdt);
    
    // Create compensating commit
    const revertCommit: Commit = {
      id: generateHash(),
      parent: { ...targetCommit, parent: null },  // Points back
      timestamp: Date.now(),
      author: this.currentAuthor,
      message: `Revert to ${targetCommit.id.slice(0,7)}`,
      crdtSnapshot: applyUpdate(currentState, inverseDiff),
      metadata: { revertOf: targetCommit.id }
    };
    
    await this.storeCommit(revertCommit, revertCommit.crdtSnapshot);
    return revertCommit;
  }

  private hashCommit(commit: Commit): string {
    const content = JSON.stringify({
      parent: commit.parent?.id,
      timestamp: commit.timestamp,
      author: commit.author,
      message: commit.message,
      metadata: commit.metadata,
      crdtSnapshot: Array.from(new Uint8Array(commit.crdtSnapshot))
    });
    return sha256(content);
  }
}
```

### Layer 2: Graph Semantics (Kernel API)

```typescript
// apps/kernel/src/graph/versioned-graph.ts

export class VersionedGraph {
  private versionStore: VersionStore;
  private branches: Map<string, string> = new Map();  // name → commitId
  private workingBranch: string = "main";
  private ydoc: Y.Doc;

  /**
   * Commit: Snapshot current CRDT state
   */
  async commit(opts: { message: string; tags?: string[] }): Promise<Commit> {
    const crdtState = Y.encodeStateAsUpdate(this.ydoc);
    
    const commit: Commit = {
      id: generateHash(),
      parent: this.getHeadCommit(),
      timestamp: Date.now(),
      author: await this.getCurrentAuthor(),
      message: opts.message,
      crdtSnapshot: crdtState,
      metadata: { tags: opts.tags ?? [] }
    };

    await this.versionStore.storeCommit(commit, crdtState);
    this.branches.set(this.workingBranch, commit.id);
    
    return commit;
  }

  /**
   * Branch: Create mutable ref to a commit
   */
  async branch(name: string, fromCommit?: string): Promise<Branch> {
    const commitId = fromCommit ?? this.branches.get(this.workingBranch);
    
    if (!commitId) {
      throw new Error("No commit to branch from");
    }

    this.branches.set(name, commitId);
    
    return {
      name,
      headCommit: await this.versionStore.loadCommit(commitId),
      local: true
    };
  }

  /**
   * Checkout: Restore CRDT state from commit, switch branch
   */
  async checkout(ref: string): Promise<void> {
    const commitId = this.branches.get(ref);
    
    if (!commitId) {
      throw new Error(`Branch ${ref} not found`);
    }

    const { crdt } = await this.versionStore.loadCommit(commitId);
    
    // Clear current Y.Doc
    this.ydoc.destroy();
    this.ydoc = new Y.Doc();
    
    // Restore from snapshot
    Y.applyUpdate(this.ydoc, crdt);
    
    this.workingBranch = ref;
  }

  /**
   * Revert: Create compensating commit
   */
  async revert(commitId: string): Promise<Commit> {
    const targetCommit = await this.versionStore.getCommit(commitId);
    const currentState = Y.encodeStateAsUpdate(this.ydoc);
    
    const revertCommit = await this.versionStore.storeRevert(
      targetCommit,
      currentState
    );
    
    // Checkout the reverted state
    await this.checkout(this.workingBranch);
    
    return revertCommit;
  }

  /**
   * Log: Browse history with filtering
   */
  async log(opts?: { filter?: string; limit?: number }): Promise<Commit[]> {
    let commits: Commit[] = [];
    let current = this.getHeadCommit();
    let count = 0;

    while (current && (opts?.limit ? count < opts.limit : true)) {
      if (!opts?.filter || this.matchesFilter(current, opts.filter)) {
        commits.push(current);
        count++;
      }
      current = current.parent;
    }

    return commits;
  }

  /**
   * Status: Show working state
   */
  status(): WorkingGraph {
    const headCommit = this.getHeadCommit();
    const currentState = Y.encodeStateAsUpdate(this.ydoc);
    const isDirty = this.hasUncommittedChanges(currentState, headCommit.crdtSnapshot);

    return {
      branch: this.workingBranch,
      headCommit,
      isDirty,
      uncommittedChanges: isDirty ? this.computeChanges() : []
    };
  }

  private getHeadCommit(): Commit {
    const commitId = this.branches.get(this.workingBranch);
    return this.versionStore.loadCommit(commitId);
  }

  private hasUncommittedChanges(current: Uint8Array, committed: Uint8Array): boolean {
    return !bytesEqual(current, committed);
  }
}
```

### Layer 3: Testing (Invariants)

```typescript
// packages/sync-crdt/test/versioning.invariants.test.ts

describe('Graph Versioning Invariants', () => {
  
  describe('Invariant 1: Reproducibility', () => {
    it('same commit always yields identical state', async () => {
      const graph = new VersionedGraph();
      
      // Create commits
      await graph.commit({ message: "State A" });
      await graph.commit({ message: "State B" });
      
      const commitB = graph.getHeadCommit();
      
      // Checkout B multiple times
      await graph.checkout('main');
      const state1 = Y.encodeStateAsUpdate(graph.ydoc);
      
      await graph.checkout('draft');
      await graph.checkout('main');
      const state2 = Y.encodeStateAsUpdate(graph.ydoc);
      
      expect(state1).toEqual(state2);
    });
  });

  describe('Invariant 2: Causal Consistency', () => {
    it('history maintains parent chain', async () => {
      const graph = new VersionedGraph();
      
      const c1 = await graph.commit({ message: "1" });
      const c2 = await graph.commit({ message: "2" });
      const c3 = await graph.commit({ message: "3" });
      
      expect(c2.parent.id).toBe(c1.id);
      expect(c3.parent.id).toBe(c2.id);
    });
  });

  describe('Invariant 3: Sync Safety', () => {
    it('revert does not break multi-device convergence', async () => {
      const deviceA = new VersionedGraph();
      const deviceB = new VersionedGraph();
      
      // Both start with same state
      const initial = await deviceA.commit({ message: "Initial" });
      await deviceB.checkout(initial.id);
      
      // Device A: adds data, reverts
      const badCommit = await deviceA.commit({ message: "Bad" });
      await deviceA.revert(initial.id);
      
      // Device B: still on initial
      expect(deviceB.getHeadCommit().id).toBe(initial.id);
      
      // Sync operations (CRDT merge)
      const syncedA = deviceA.getSyncUpdates();
      const syncedB = deviceB.getSyncUpdates();
      
      // Both apply updates
      await deviceA.applySyncUpdates(syncedB);
      await deviceB.applySyncUpdates(syncedA);
      
      // Should converge to revert state
      expect(deviceA.getHeadCommit().id).toBe(deviceB.getHeadCommit().id);
    });
  });

  describe('Invariant 4: Schema Continuity', () => {
    it('old schema commits remain accessible after upgrade', async () => {
      // TODO: integrate with ADR-010 schema manager
    });
  });

  describe('Invariant 5: Performance', () => {
    it('checkout fast even with 10k commits', async () => {
      const graph = new VersionedGraph();
      
      // Generate commits
      for (let i = 0; i < 10000; i++) {
        await graph.commit({ message: `Commit ${i}` });
      }
      
      const startTime = performance.now();
      await graph.checkout("main");
      const elapsed = performance.now() - startTime;
      
      expect(elapsed).toBeLessThan(100);  // ms
    });
  });
});
```

---

## Relationship to Other ADRs

| ADR | How it plays |
|-----|-------------|
| [ADR-002](ADR-002-offline-first-architecture.md) | Versioning leverages offline-first CRDT syncing |
| [ADR-003](ADR-003-crdt-synchronization.md) | Yjs CRDT is underlying storage mechanism |
| [ADR-010](ADR-010-schema-evolution.md) | Schema upcasting applies when checking out old commits |
| [ADR-017](ADR-017-studio-micro-kernel-and-plugin-boundary.md) | Versioning API exposed by kernel to plugins |

---

## Rollout Plan

| Phase | Scope | Timeline |
|-------|-------|----------|
| v0.1.x (Foundation) | `commit()`, `branch()`, single-device tests | Sprint 1-2 |
| v0.2.x (Safety) | Invariants 1-3 test coverage, revert draft | Sprint 3-4 |
| v0.3.x (Multi-device) | Sync safety validation (Invariant 3 refinement) | Sprint 5-6 |
| v1.0.0 | All 5 invariants guaranteed, GA | TBD |

---

## Open Questions

1. **UI Representation**: How do branches appear in Studio UI? (not this ADR's scope)
2. **Conflict Policy**: When branch merge conflicts, what's the resolution strategy? (future ADR)
3. **Compression**: How to compact long histories for performance? (future ADR on snapshots)
4. **GC Strategy**: When can old commits be safely garbage-collected? (future privacy ADR)

---

## References

- [CRDT Theory](https://crdt.tech/)
- [Git Internals](https://git-scm.com/book/en/v2/Git-Internals)
- [Merkle Trees](https://en.wikipedia.org/wiki/Merkle_tree)
