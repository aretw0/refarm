# ADR-024: Pessimistic Editing Modes (Locks via Private Branches)

**Status**: ✏️ PROPOSED (Design Phase)  
**Date**: 2026-03-07  
**Deciders**: Core Team  
**Related**: ADR-020 (Graph Versioning), ADR-003 (CRDT), ADR-002 (Offline-First)  
**Target Version**: v0.3.0+

---

## Context

**Philosophical conflict:**

Refarm uses **CRDTs** (optimistic, multi-writer, eventual consistency):

- Multiple users edit simultaneously
- Conflicts resolved automatically (merge)
- No one is "blocked" waiting for lock

But users are accustomed to **pessimistic locks** (single-writer, immediate consistency):

- Google Docs: "Fulano is editing this paragraph" (visual lock, not enforced)
- Notion: "Fulano is editing" (page-level lock)
- Git: Branch = isolated workspace, merge when ready
- Traditional databases: Row-level locks

**User expectation mismatch:**
> "If I'm editing a task, I don't want someone else changing the priority while I'm working on it."

**Current Refarm behavior**:

- User A edits `task.priority` → writes to CRDT
- User B edits `task.priority` at same time → writes to CRDT
- Both succeed, last-write-wins or CRDT merge
- **No way to "lock" a node for exclusive editing**

---

## Decision

**Support pessimistic editing modes as an OPTIONAL UX pattern built on top of graph versioning (ADR-020).**

Key insights:

1. **Don't fight CRDT**: Keep eventual consistency as foundation
2. **Locks are UX, not architecture**: Implement as "private branch" metaphor
3. **User choice**: Some workflows need locks (task editing), others don't (chat messages)
4. **Graceful degradation**: Lock expires → auto-merge (offline-first survives)

---

## Solution: "Private Branches" for Exclusive Editing

### Concept

When user wants to "lock" a node for editing:

1. **Create private branch**: `branch-user-123-node-456`
2. **UI shows "locked"**: Other users see "Alice is editing (view-only)"
3. **Edits go to private branch**: Isolated from main branch
4. **Commit when done**: Merge private branch → main (one atomic operation)
5. **Expire if abandoned**: 5 minutes inactive → auto-merge or discard

### Graph Versioning Integration (ADR-020)

```typescript
// User clicks "Edit Task" (pessimistic mode)
async function startPessimisticEdit(nodeId: string, userId: string) {
  // Create private branch for this edit session
  const branchId = `edit-${userId}-${nodeId}-${Date.now()}`;
  
  await graph.branch({
    from: 'main',
    name: branchId,
    metadata: {
      type: 'pessimistic-edit',
      nodeId,
      userId,
      lockedAt: Date.now(),
      expiresAt: Date.now() + (5 * 60 * 1000) // 5 minutes
    }
  });
  
  // Switch user to private branch
  await graph.checkout(branchId);
  
  // Broadcast lock to other users
  await sync.broadcast({
    type: 'node-locked',
    nodeId,
    userId,
    branchId
  });
  
  return { branchId, lockedUntil: Date.now() + (5 * 60 * 1000) };
}

// User finishes editing
async function commitPessimisticEdit(branchId: string, nodeId: string) {
  // Commit changes on private branch
  await graph.commit({
    message: `Edit ${nodeId} by ${userId}`,
    branch: branchId
  });
  
  // Merge back to main
  const mergeResult = await graph.merge({
    from: branchId,
    to: 'main',
    strategy: 'prefer-source' // Private branch wins (user's intent)
  });
  
  // Broadcast unlock
  await sync.broadcast({
    type: 'node-unlocked',
    nodeId,
    branchId
  });
  
  // Delete private branch (cleanup)
  await graph.deleteBranch(branchId);
  
  return mergeResult;
}

// Lock expires (user abandoned edit)
async function handleLockExpiry(branchId: string, nodeId: string) {
  // Check if user made any changes
  const commits = await graph.log({ branch: branchId, limit: 1 });
  
  if (commits.length > 0) {
    // User made changes → auto-merge
    await graph.merge({
      from: branchId,
      to: 'main',
      strategy: 'prefer-source',
      message: `Auto-merge expired lock for ${nodeId}`
    });
  } else {
    // No changes → discard branch
    await graph.deleteBranch(branchId);
  }
  
  // Broadcast unlock
  await sync.broadcast({
    type: 'node-unlocked',
    nodeId,
    reason: 'expired'
  });
}
```

---

## User Experience Patterns

### Pattern 1: Visual Lock (Soft Lock)

**Google Docs style**: Show who's editing, but don't enforce.

```
┌─────────────────────────────────────────────────┐
│ Task: Implement ADR-024                          │
│                                                  │
│ 👤 Alice is editing the description              │
│                                                  │
│ Title: [Implement ADR-024..................]    │
│ Priority: [High ▼]                              │
│ Description:                                     │
│   ┌─────────────────────────────────────────┐  │
│   │ [Alice is typing...]                    │  │
│   │ This ADR proposes...                    │  │
│   └─────────────────────────────────────────┘  │
│                                                  │
│ ℹ️  You can edit other fields while Alice       │
│    works on the description.                    │
│                                                  │
│ [Save] [Cancel]                                  │
└─────────────────────────────────────────────────┘
```

**Implementation**:

- Alice creates private branch for `task.description` only (field-level)
- Other users see real-time cursor position (via sync)
- Bob can edit `task.priority` on main branch (no conflict)
- When Alice commits → merges description changes

**Trade-off**: Not true lock (Bob could edit description too, rare)

---

### Pattern 2: Hard Lock (Node-Level)

**Notion style**: Entire node locked for single user.

```
┌─────────────────────────────────────────────────┐
│ 🔒 Task: Implement ADR-024                       │
│                                                  │
│ Alice is editing this task (started 2m ago)     │
│                                                  │
│ ○ Wait for Alice to finish                      │
│ ● Request edit access                            │
│ ○ Open in view-only mode                        │
│ ○ Force unlock (requires permission)            │
│                                                  │
│ [Continue] [Cancel]                              │
└─────────────────────────────────────────────────┘
```

**Implementation**:

- Alice creates private branch for entire node
- Bob's UI shows node as "locked" (read-only)
- Bob can "request access" → notification to Alice
- Alice finishes → commits → Bob can edit

**Trade-off**: Blocks collaboration (but that's the point)

---

### Pattern 3: Optimistic with Conflict Preview

**Figma style**: Simultaneous editing, show conflicts before commit.

```
┌─────────────────────────────────────────────────┐
│ Task: Implement ADR-024                          │
│                                                  │
│ ⚠️  Conflicts detected!                          │
│                                                  │
│ You changed:                                     │
│   Priority: High → Critical                      │
│                                                  │
│ While you were editing, Alice changed:           │
│   Priority: High → Medium                        │
│                                                  │
│ Resolve:                                         │
│ ○ Keep your changes (Critical)                   │
│ ● Keep Alice's changes (Medium)                  │
│ ○ Manual merge                                   │
│                                                  │
│ [Apply] [Cancel]                                 │
└─────────────────────────────────────────────────┘
```

**Implementation**:

- Both users edit on private branches
- On commit, kernel detects conflict (both modified same field)
- UI shows diff before merging
- User chooses resolution

**Trade-off**: User must resolve conflicts (but informed, not silent)

---

### Pattern 4: Explicit Checkout (Git Style)

**Developer workflow**: Branch = isolated workspace.

```
┌─────────────────────────────────────────────────┐
│ Task: Implement ADR-024                          │
│                                                  │
│ Branch: draft-adr-024 (private)                 │
│                                                  │
│ You're working on a private draft.              │
│ Changes won't be visible to others until you    │
│ publish this branch.                             │
│                                                  │
│ [Commit Draft] [Preview Changes] [Publish]       │
└─────────────────────────────────────────────────┘
```

**Implementation**:

- User explicitly creates branch ("Start Draft")
- All edits on private branch
- User previews diff (`git diff`)
- User publishes → merges to main

**Trade-off**: More steps, but maximum control

---

## Lock Scopes

Different granularities:

### 1. Field-Level Lock

Lock specific field, allow editing other fields:

```typescript
{
  "lock": {
    "scope": "field",
    "path": "task.description",
    "nodeId": "task-123",
    "userId": "alice",
    "expiresAt": 1709856300
  }
}
```

**Use case**: Google Docs paragraph-level editing

---

### 2. Node-Level Lock

Lock entire node:

```typescript
{
  "lock": {
    "scope": "node",
    "nodeId": "task-123",
    "userId": "alice",
    "expiresAt": 1709856300
  }
}
```

**Use case**: Notion page-level editing

---

### 3. Subgraph Lock

Lock node + all children (recursive):

```typescript
{
  "lock": {
    "scope": "subgraph",
    "rootNodeId": "project-x",
    "userId": "alice",
    "expiresAt": 1709856300
  }
}
```

**Use case**: Refactoring project structure (don't want interference)

---

## Conflict Resolution Strategies

When merging private branch → main:

### Strategy 1: Last-Write-Wins (CRDT Default)

```typescript
{
  "mergeStrategy": "last-write-wins",
  "winner": "timestamp" // Or "branch-source"
}
```

Simple, but can lose data.

---

### Strategy 2: Prefer Source (Lock Holder Wins)

```typescript
{
  "mergeStrategy": "prefer-source",
  "source": "private-branch"
}
```

User who held lock wins all conflicts (their intent is preserved).

---

### Strategy 3: Interactive Resolution

```typescript
{
  "mergeStrategy": "interactive",
  "onConflict": "prompt-user"
}
```

Show conflict UI, user decides field-by-field.

---

### Strategy 4: Auto-Merge Non-Conflicting

```typescript
{
  "mergeStrategy": "auto-merge",
  "onConflict": "prefer-source" // Fallback for conflicts
}
```

Alice edited `description`, Bob edited `priority` → both succeed (no conflict).  
Alice edited `priority`, Bob edited `priority` → prefer Alice (lock holder).

---

## Lock Expiry & Cleanup

### Automatic Expiry

```typescript
{
  "lock": {
    "expiresAt": 1709856300, // 5 minutes from now
    "renewalStrategy": "on-activity", // Extend if user still active
    "renewalInterval": 60000 // Renew every 60s
  }
}
```

### Cleanup on Disconnect

```typescript
// User closes tab → WebSocket disconnects
socket.on('disconnect', async () => {
  // Find all locks held by this user
  const locks = await lockManager.getLocksForUser(userId);
  
  for (const lock of locks) {
    if (lock.hasChanges) {
      // User made changes → auto-commit
      await commitPessimisticEdit(lock.branchId, lock.nodeId);
    } else {
      // No changes → discard lock
      await graph.deleteBranch(lock.branchId);
    }
  }
});
```

---

## Multi-Device Behavior

**Question**: What if Alice locks on laptop, then opens phone?

### Option A: Lock is User-Scoped

```typescript
{
  "lock": {
    "userId": "alice",
    "devices": ["laptop", "phone"] // Both can edit
  }
}
```

Alice's phone sees "You're editing this on your laptop. Continue here?"

**Merge on commit**: Private branch syncs across Alice's devices, commits to main when done.

---

### Option B: Lock is Device-Scoped

```typescript
{
  "lock": {
    "userId": "alice",
    "deviceId": "laptop-abc123",
    "devices": ["laptop-abc123"] // Only laptop can edit
  }
}
```

Alice's phone sees "Locked by your laptop. Force unlock?"

**Trade-off**: Annoying if user switches devices frequently.

---

## Offline Behavior (Critical!)

**What if lock expires while user is offline?**

### Scenario: Alice locks task, goes offline for 10 minutes

1. **Lock expires after 5 minutes** (Alice offline, can't renew)
2. **Bob takes lock** and edits task
3. **Alice comes back online** with uncommitted changes on private branch

**Resolution**:

```typescript
async function handleStaleLock(userId: string, branchId: string) {
  // Alice's client detects lock expired
  
  // Check if changes were made
  const hasChanges = await graph.diff({
    branch: branchId,
    against: 'main'
  });
  
  if (!hasChanges.length) {
    // No changes → discard
    await graph.deleteBranch(branchId);
    return;
  }
  
  // User made changes while offline
  // Prompt: "Your lock expired. Changes found. What to do?"
  
  const choice = await ui.prompt({
    title: "Lock Expired",
    message: "You were editing offline and the lock expired. Bob edited the same task.",
    options: [
      "Keep my changes (overwrite Bob's)",
      "Keep Bob's changes (discard mine)",
      "Merge manually"
    ]
  });
  
  switch (choice) {
    case 0:
      await graph.merge({ from: branchId, to: 'main', strategy: 'prefer-source' });
      break;
    case 1:
      await graph.deleteBranch(branchId);
      break;
    case 2:
      await ui.showMergeConflictEditor(branchId, 'main');
      break;
  }
}
```

**Key insight**: Offline-first survives! Private branch preserves Alice's work even if lock expires.

---

## Plugin Integration

Plugins can request locks programmatically:

```typescript
// Plugin: Task Manager
async function editTask(taskId: string) {
  // Request pessimistic lock
  const lock = await kernel.requestLock({
    nodeId: taskId,
    scope: 'node',
    timeout: 300000, // 5 minutes
    strategy: 'prefer-source'
  });
  
  if (!lock.acquired) {
    // Someone else has lock
    ui.notify({
      type: 'info',
      message: `${lock.holder} is editing this task`
    });
    return;
  }
  
  // User edits task (on private branch now)
  await ui.showTaskEditor(taskId);
  
  // User clicks "Save"
  await kernel.releaseLock({
    lockId: lock.id,
    commit: true // Merge private branch → main
  });
}
```

---

## Configuration (User/Workspace Level)

Users/workspaces can choose default behavior:

```typescript
{
  "pessimisticEditing": {
    "enabled": true,
    "defaultMode": "soft-lock", // soft-lock|hard-lock|optimistic
    "lockTimeout": 300000, // 5 minutes
    "autoCommitOnDisconnect": true,
    "nodeTypes": {
      "task": {
        "mode": "hard-lock", // Tasks require hard locks
        "scope": "node"
      },
      "chat-message": {
        "mode": "optimistic" // Chat messages are always optimistic
      }
    }
  }
}
```

---

## Testing Strategy

### Test 1: Basic Lock Acquisition

```typescript
test('user can lock node for exclusive editing', async () => {
  const lock = await alice.requestLock({ nodeId: 'task-1' });
  
  expect(lock.acquired).toBe(true);
  expect(lock.branchId).toBeDefined();
  
  // Bob tries to lock same node
  const bobLock = await bob.requestLock({ nodeId: 'task-1' });
  
  expect(bobLock.acquired).toBe(false);
  expect(bobLock.holder).toBe('alice');
});
```

### Test 2: Lock Expiry

```typescript
test('lock expires after timeout', async () => {
  const lock = await alice.requestLock({
    nodeId: 'task-1',
    timeout: 1000 // 1 second
  });
  
  expect(lock.acquired).toBe(true);
  
  // Wait 2 seconds
  await sleep(2000);
  
  // Bob can now acquire lock
  const bobLock = await bob.requestLock({ nodeId: 'task-1' });
  expect(bobLock.acquired).toBe(true);
});
```

### Test 3: Offline Editing with Expired Lock

```typescript
test('offline edits preserved even if lock expires', async () => {
  const lock = await alice.requestLock({
    nodeId: 'task-1',
    timeout: 1000
  });
  
  // Alice goes offline
  await alice.goOffline();
  
  // Alice edits task
  await alice.editNode('task-1', { priority: 'critical' });
  
  // Lock expires (Alice still offline)
  await sleep(2000);
  
  // Bob edits task
  await bob.editNode('task-1', { priority: 'low' });
  
  // Alice comes back online
  await alice.goOnline();
  
  // Alice's changes should be preserved on private branch
  const aliceBranch = await alice.getCurrentBranch();
  const task = await alice.getNode('task-1', { branch: aliceBranch });
  
  expect(task.priority).toBe('critical'); // Alice's edit preserved
  
  // But main branch has Bob's edit
  const mainTask = await alice.getNode('task-1', { branch: 'main' });
  expect(mainTask.priority).toBe('low');
  
  // User prompted to resolve
});
```

### Test 4: Concurrent Field Edits (No Conflict)

```typescript
test('concurrent edits on different fields succeed', async () => {
  const lock = await alice.requestLock({
    nodeId: 'task-1',
    scope: 'field',
    field: 'description'
  });
  
  // Alice edits description
  await alice.editNode('task-1', { description: 'New description' });
  
  // Bob edits priority (different field, no lock)
  await bob.editNode('task-1', { priority: 'high' });
  
  // Alice commits
  await alice.releaseLock(lock.id, { commit: true });
  
  // Both changes should be merged
  const task = await getNode('task-1');
  expect(task.description).toBe('New description');
  expect(task.priority).toBe('high');
});
```

---

## Implementation Phases

### Phase 1: Basic Private Branches (v0.3.0)

```
[ ] Extend graph.branch() to support lock metadata
[ ] Implement lockManager (acquire, release, expire)
[ ] UI: "Start Private Edit" button
[ ] UI: "Someone is editing" indicator (read-only)
```

### Phase 2: Lock Broadcasting (v0.3.0)

```
[ ] Broadcast lock events via sync layer
[ ] Real-time presence ("Alice is typing...")
[ ] Lock expiry notifications
```

### Phase 3: Conflict Resolution UI (v0.3.0+)

```
[ ] Merge conflict editor (3-way diff)
[ ] Interactive resolution UI
[ ] Undo/redo integration (ADR-020)
```

### Phase 4: Advanced Patterns (v0.4.0+)

```
[ ] Field-level locks
[ ] Subgraph locks
[ ] Plugin API for lock management
[ ] Configurable lock policies per node type
```

---

## Trade-offs & Philosophy

### Why This is Optional, Not Default

**Refarm's core is optimistic (CRDT)**:

- Offline-first requires it (no central lock server)
- Scalability requires it (no bottleneck)
- Resilience requires it (no single point of failure)

**But pessimistic locks solve real UX problems**:

- "I don't want my edits overwritten"
- "I need focus time without interruptions"
- "I'm making a complex change that needs consistency"

**Solution: Have both**:

- Default: Optimistic (CRDT, always works)
- Opt-in: Pessimistic (locks, better UX for some workflows)
- Graceful degradation: Lock expires → falls back to optimistic

### Comparison to Other Systems

| System | Approach | Refarm Equivalent |
|--------|----------|-------------------|
| Google Docs | Soft locks (visual only) | Pattern 1: Visual Lock |
| Notion | Hard locks (page-level) | Pattern 2: Hard Lock |
| Figma | Optimistic + conflict preview | Pattern 3: Conflict Preview |
| Git | Explicit branches | Pattern 4: Explicit Checkout |
| Linear | Optimistic (no locks) | Default CRDT behavior |

**Refarm supports all patterns** → user/plugin chooses what fits their workflow.

---

## Success Metrics

- ✅ Users can lock nodes when desired (opt-in, not forced)
- ✅ Locks expire gracefully (offline edits preserved)
- ✅ Conflict rate decreases (fewer unexpected overwrites)
- ✅ Plugin developers can implement lock-based UX if needed
- ✅ System remains offline-first (locks don't break offline editing)

---

## Open Questions

1. **Lock priority**: What if Alice has lock, but Bob is admin? Can Bob force unlock?
   - **Proposed**: Permissions system (ADR future) defines who can force unlock

2. **Lock queuing**: Multiple users want to edit, queue them?
   - **Proposed**: First-come-first-served queue, max 5 people (after that, optimistic fallback)

3. **Lock inheritance**: If I lock a parent node, are children locked too?
   - **Proposed**: Configurable (scope: 'node' vs 'subgraph')

4. **Cross-device**: Should lock be user-scoped or device-scoped?
   - **Proposed**: User-scoped by default, device-scoped as option

---

## References

- [ADR-020: Graph Versioning](ADR-020-sovereign-graph-versioning.md) (branches foundation)
- [ADR-003: CRDT](ADR-003-crdt-synchronization.md) (optimistic default)
- [ADR-002: Offline-First](ADR-002-offline-first-architecture.md) (why locks must degrade gracefully)
- [Google Docs Conflict Resolution](https://web.dev/docs-concurrent-editing/)
- [Figma Multiplayer](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)
- [Git Branching Model](https://git-scm.com/book/en/v2/Git-Branching-Branching-Workflows)

---

## Conclusion

**Pessimistic locks are UX patterns, not architectural constraints.**

By implementing locks as **private branches** (ADR-020), Refarm gets:

- ✅ Familiar UX (users know how to "lock" documents)
- ✅ CRDT foundation preserved (offline-first survives)
- ✅ Graceful degradation (lock expires → optimistic merge)
- ✅ Flexibility (users choose per workflow)

**Best of both worlds**: Optimistic by default, pessimistic when desired.
