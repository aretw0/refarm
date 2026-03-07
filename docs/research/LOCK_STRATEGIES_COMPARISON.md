# Pessimistic Locks: How Other Systems Handle It (vs Refarm)

**Purpose**: Compare lock strategies across collaborative systems to understand trade-offs and validate ADR-024 design.

---

## Quick Comparison Table

| System | Lock Model | Granularity | Expiry | Offline Support | Refarm Equivalent |
|--------|------------|-------------|--------|-----------------|-------------------|
| **Google Docs** | Soft visual lock (not enforced) | Paragraph | No expiry (presence-based) | ❌ No (online-only) | Pattern 1: Visual Lock |
| **Notion** | Hard page lock | Page-level | ~5 minutes idle | ❌ No (conflicts on reconnect) | Pattern 2: Hard Lock |
| **Figma** | Optimistic + conflict warning | Object-level | N/A (no locks) | ⚠️ Partial (local changes merge) | Pattern 3: Conflict Preview |
| **Git** | Explicit branch (manual) | Repository | Infinite (manual merge) | ✅ Yes (full offline) | Pattern 4: Explicit Checkout |
| **Linear** | Pure optimistic (CRDT) | N/A | N/A | ✅ Yes | Default CRDT (no locks) |
| **Confluence** | Page lock on edit | Page | 30 minutes | ❌ No | Pattern 2: Hard Lock |
| **Dropbox Paper** | Soft lock (visual) | Block-level | Presence-based | ❌ No | Pattern 1: Visual Lock |
| **Roam Research** | Pure optimistic | N/A | N/A | ⚠️ Partial | Default CRDT |
| **Obsidian** | File-system locks | File | N/A (OS-level) | ✅ Yes (local files) | Not applicable (local-first) |
| **Refarm** | **Optional private branches** | **Node/Field/Subgraph** | **Configurable (default 5min)** | ✅ **Yes (offline edits preserved)** | **All 4 patterns supported** |

---

## Deep Dive: What Each System Does

### 1. Google Docs: Soft Visual Lock (Not Enforced)

**How it works**:

```
User A is typing in paragraph 3 → cursor visible to others
User B sees "User A is editing" → visual indicator
User B CAN still edit paragraph 3 (lock not enforced)
Result: Operational Transform (OT) merges changes
```

**Architecture**:

- Central server holds canonical state
- Client sends operations (insert char at position X)
- Server orders operations, broadcasts to all clients
- **Lock is UX only** (visual feedback, not enforced)

**Trade-offs**:

- ✅ Low conflict rate (visual deterrent)
- ✅ No one blocked
- ❌ Doesn't work offline (needs server)
- ❌ Can still have conflicts (if two users type simultaneously)

**Why Refarm is different**:

- Refarm private branch = **enforced lock** (other users truly blocked)
- But also supports soft lock (Pattern 1) if wanted
- Works offline (branch is local until merged)

---

### 2. Notion: Hard Page Lock

**How it works**:

```
User A opens page for editing → page locked
User B tries to open → "User A is editing" (read-only)
User A closes or idle 5 minutes → page unlocked
User B can now edit
```

**Architecture**:

- Server maintains lock table (pageId → userId + timestamp)
- Client sends `lock_acquire` request
- Server grants or denies (only one user can hold lock)
- Lock released on disconnect or timeout

**Trade-offs**:

- ✅ No conflicts (only one writer at a time)
- ✅ Clear ownership (user knows they have exclusive access)
- ❌ Blocks collaboration (only one person can edit)
- ❌ Doesn't work offline (needs server to grant lock)
- ❌ Lock can expire unexpectedly (user lose work if not saved)

**Why Refarm is different**:

- Refarm private branch = **offline lock** (no server needed)
- Lock expiry → auto-merge (user's work preserved)
- Supports hard lock (Pattern 2) but **offline-first compatible**

---

### 3. Figma: Optimistic + Conflict Warning

**How it works**:

```
User A moves object → broadcasts to server
User B moves same object → broadcasts to server
Server: Conflict detected → both succeed (CRDT-like merge)
Result: Object position = last write wins (or vector merge)
Optional: Warning "User B also edited this" (soft alert)
```

**Architecture**:

- CRDT-inspired (though not pure CRDT, proprietary "Figma merge")
- No locks, all edits succeed
- Server detects conflicts post-hoc
- Optional conflict warnings in UI

**Trade-offs**:

- ✅ Highly collaborative (50+ users can edit simultaneously)
- ✅ No blocking
- ⚠️ Conflicts still happen (but rare due to spatial nature)
- ❌ Offline support limited (local changes queue, merge on reconnect)

**Why Refarm is different**:

- Refarm CRDT is **true offline-first** (Yjs, proven algorithm)
- Supports optimistic (default) AND pessimistic (opt-in)
- Conflict preview (Pattern 3) shows conflicts **before merge** (Git-style)

---

### 4. Git: Explicit Branch (Manual Workflow)

**How it works**:

```
Developer: git checkout -b feature-x (create branch)
→ All work on feature-x branch (isolated)
→ git commit -m "changes" (local commits)
→ git merge main (when ready, merge back)
→ Conflicts? Resolve manually
```

**Architecture**:

- Distributed (no central lock server)
- Branch = isolated workspace (full copy of state)
- Merge = explicit operation (user decides when)
- Conflicts = manual resolution (diff editor)

**Trade-offs**:

- ✅ Full offline support (Git is distributed)
- ✅ Complete isolation (branch = safe experimentation)
- ✅ Powerful merge strategies (rebase, squash, 3-way merge)
- ❌ High cognitive overhead (developers learn, end-users struggle)
- ❌ Manual resolution required (no auto-merge)

**Why Refarm is different**:

- Refarm private branch = **automatic Git workflow** (UX abstraction)
- "Edit Task" → creates branch → user edits → "Save" → auto-merge
- Conflict resolution UI (not command-line)
- **Same isolation, better UX**

---

### 5. Linear: Pure Optimistic (No Locks)

**How it works**:

```
User A edits issue priority → writes to CRDT
User B edits issue priority → writes to CRDT
Result: Last write wins (timestamp-based)
No locks, no warnings, just works
```

**Architecture**:

- Sync engine (similar to Replicache/CRDT)
- Client sends mutations → server applies → broadcasts
- Conflicts resolved automatically (last-write-wins)
- **No lock concept at all**

**Trade-offs**:

- ✅ Simple mental model (just edit, it syncs)
- ✅ Offline works (local mutations queue)
- ✅ Fast (no lock acquisition overhead)
- ❌ Silent overwrites (your change might be overwritten)
- ❌ No way to "claim" exclusive editing

**Why Refarm is different**:

- Refarm **default** is same as Linear (pure optimistic)
- But ADR-024 adds **optional pessimistic mode** (when needed)
- User/plugin chooses per workflow

---

### 6. Confluence: Page Lock on Edit

**How it works**:

```
User A clicks "Edit" → page locked (30 minutes)
User B tries to edit → "Page is locked" (can view only)
After 30 minutes → auto-unlocked (even if User A still editing)
User A must save → or changes lost
```

**Architecture**:

- Server-side lock (pageId → userId + timestamp)
- Lock expires after 30 minutes (hard limit)
- No auto-save → user loses work if lock expires

**Trade-offs**:

- ✅ No conflicts (only one editor)
- ❌ Terrible UX (lock expires mid-edit)
- ❌ No offline support
- ❌ Users lose work frequently

**Why Refarm is different**:

- Refarm lock expiry → **auto-merge** (never lose work)
- Private branch preserves changes even if lock expires
- Offline edits always saved

---

### 7. Dropbox Paper: Soft Lock (Visual, Block-Level)

**How it works**:

```
User A types in block 5 → cursor visible
User B sees "User A is editing this block"
User B can edit other blocks freely
Visual lock (not enforced) → rare conflicts
```

**Architecture**:

- Similar to Google Docs (OT-based)
- Block-level visual locks (paragraph, image, etc.)
- Presence-based (disconnected → lock released)

**Trade-offs**:

- ✅ Fine-grained (block-level, not page-level)
- ✅ Collaborative (multiple users in different blocks)
- ❌ No offline support
- ❌ Visual lock can be ignored (not enforced)

**Why Refarm is different**:

- Refarm supports **field-level locks** (even finer than blocks)
- Enforced (not just visual)
- Works offline

---

### 8. Roam Research: Pure Optimistic

**How it works**:

```
User A edits block → CRDT merge
User B edits same block → CRDT merge
Result: Both edits preserved (character-level merge)
```

**Architecture**:

- CRDT-based (likely Automerge or similar)
- No locks, all edits merge
- Offline-first (local-first)

**Trade-offs**:

- ✅ Highly collaborative
- ✅ Offline works perfectly
- ❌ Merge artifacts (rare but confusing when happens)
- ❌ No way to prevent conflicts

**Why Refarm is different**:

- Refarm **same default** (CRDT, offline-first)
- But adds **optional locks** (when CRDT merge isn't desired)

---

### 9. Obsidian: File-System Locks

**How it works**:

```
User opens note.md → OS file lock (read-write)
Another app tries to edit → blocked (or read-only)
User closes → file unlocked
```

**Architecture**:

- OS-level file locks (not collaborative)
- Single-user (local files)
- Git can be used for multi-user sync (manual)

**Trade-offs**:

- ✅ Simple (OS handles it)
- ✅ Offline (local files)
- ❌ No real-time collaboration
- ❌ Conflicts on Git merge (manual resolution)

**Why Refarm is different**:

- Refarm is **multi-user by design** (CRDT sync)
- But can emulate single-user experience (private branch = locked file)

---

## Key Insights for Refarm (ADR-024)

### 1. **Central Server Locks Break Offline**

Google Docs, Notion, Confluence: All require server to grant lock.  
→ **Refarm solution**: Private branch = local lock (no server needed)

### 2. **Lock Expiry Can Lose Work**

Confluence: Lock expires → user loses changes.  
→ **Refarm solution**: Lock expires → auto-merge (work preserved)

### 3. **Hard Locks Block Collaboration**

Notion: Only one editor at a time.  
→ **Refarm solution**: Optional (user enables when desired, not forced)

### 4. **Soft Locks Are Weak**

Google Docs, Dropbox Paper: Visual only, can be ignored.  
→ **Refarm solution**: Enforced locks (private branch) OR soft locks (Pattern 1)

### 5. **Pure Optimistic Can Overwrite**

Linear, Roam: Last-write-wins → silent overwrites.  
→ **Refarm solution**: Default optimistic, but pessimistic available

### 6. **Git Model is Powerful but Complex**

Git: Branches are amazing, but high learning curve.  
→ **Refarm solution**: Same isolation, automatic workflow (UX abstraction)

---

## Refarm's Unique Position

**Only system that combines**:

1. ✅ **Offline-first locks** (private branches, no server needed)
2. ✅ **Graceful expiry** (auto-merge preserves work)
3. ✅ **Flexible granularity** (node-level, field-level, subgraph-level)
4. ✅ **Optional** (default optimistic, opt-in pessimistic)
5. ✅ **CRDT foundation** (when locks expire, falls back to proven merge)

**No other system has all 5.**

- Google Docs: ❌ No offline
- Notion: ❌ No graceful expiry
- Figma: ❌ No true locks
- Git: ❌ Not automatic/user-friendly
- Linear: ❌ No lock option

**Refarm = Best of all worlds.**

---

## Real-World Use Cases (When Each Pattern Fits)

### Pattern 1: Visual Lock (Soft)
**Use case**: Collaborative docs, chat messages  
**Why**: Low conflict risk, high collaboration need  
**Example**: Team editing meeting notes simultaneously

### Pattern 2: Hard Lock (Enforced)
**Use case**: Critical data (financial records, contracts)  
**Why**: Must prevent conflicts, correctness > collaboration  
**Example**: Accountant editing invoice (one person at a time)

### Pattern 3: Conflict Preview
**Use case**: Design work, data entry  
**Why**: Conflits rare but when happen, need resolution  
**Example**: Designer moving objects on canvas

### Pattern 4: Explicit Checkout (Git-style)
**Use case**: Complex refactoring, drafts  
**Why**: Need isolation, preview before publishing  
**Example**: Developer restructuring codebase

### No Lock (Pure Optimistic)
**Use case**: Fast-moving data (chat, social feed)  
**Why**: Collaboration speed > consistency  
**Example**: Team chat, activity log

---

## Conclusion

**ADR-024 design is validated** by analyzing 9 mature systems:

- ✅ Solves central-server dependency (offline private branches)
- ✅ Solves lock expiry data loss (auto-merge)
- ✅ Solves collaboration blocking (optional, not forced)
- ✅ Solves complexity (automatic workflow, not Git CLI)
- ✅ Solves limited granularity (node/field/subgraph)

**Refarm's approach**:

- **Default**: Optimistic (Linear, Roam model)
- **Opt-in**: Pessimistic (Git model, but automatic)
- **Graceful**: Lock expires → CRDT fallback (unique)

**No system has all three.** Refarm does.
