# ADR-003: CRDT Choice (Yjs)

**Status**: Superseded by [ADR-045](ADR-045-loro-crdt-adoption.md) (2026-03-17)
**Date**: 2026-03-06
**Deciders**: Core Team  
**Related**: [ADR-002 (Offline-First)](ADR-002-offline-first-architecture.md), [Validation 2](../../docs/research/critical-validations.md#validação-2-crdt--opfs-quota-limite--confirmado)

---

## Context

Refarm requires automatic conflict resolution for multi-device synchronization. Users should be able to edit data offline on multiple devices, then sync when they connect, without manual conflict resolution.

**Requirements**:

1. **Automatic merge**: Conflicts resolve without user intervention
2. **Commutative**: Operations apply in any order, converge to same state
3. **CRDTs proven**: Use battle-tested library, not custom implementation
4. **Performance**: Handle 100k+ operations efficiently
5. **Browser-compatible**: Works in Web Workers, persists to OPFS
6. **JSON-LD compatible**: Can represent semantic graph structure

**Use cases**:

- User edits task on phone (offline)
- User edits same task on laptop (offline)
- Devices sync → both see merged result
- No "conflict dialog", no lost data

---

## Decision

**We adopt Yjs as our CRDT library.**

### Why Yjs?

**Performance** (Benchmark: [crdt-benchmarks](https://github.com/dmonad/crdt-benchmarks))

| Benchmark | Yjs | Automerge | Ratio |
|-----------|-----|-----------|-------|
| B1.1 (Insert text) | 0.13s | 2.34s | **18x faster** |
| B2.1 (Insert table) | 0.45s | 3.96s | **8.8x faster** |
| B3 (Real-world collab) | 0.92s | 11.67s | **12.7x faster** |
| B4 (Large doc) | 5.7s | 28.6s | **5x faster** |
| B4x100 (25M ops) | 608s | N/A | 327MB RAM |

**Key metrics**:

- **Parse time**: 39ms for 159KB document
- **State vector**: 29 bytes (efficient sync)
- **Update size**: 27-36 bytes per operation

**Production-ready**:

- Used by: Figma (multiplayer), Linear (real-time), BlockNote (editor)
- Maintained: Active development, large community
- Web Worker support: Native, no hacks

### Yjs Data Types

```typescript
import * as Y from 'yjs';

// Shared document (root)
const ydoc = new Y.Doc();

// Map (key-value, LWW for values)
const nodes = ydoc.getMap('nodes');
nodes.set('task-123', {
  '@type': 'Task',
  'name': 'Buy groceries',
  'status': 'pending'
});

// Array (list with positional CRDT)
const taskList = ydoc.getArray('tasks');
taskList.push(['task-123']);

// Text (collaborative text editing)
const description = ydoc.getText('description');
description.insert(0, 'Go to store...');

// Nested structures
const nestedMap = new Y.Map();
nestedMap.set('created', Date.now());
nodes.set('metadata', nestedMap);
```

### Mapping JSON-LD to Yjs

**Strategy**: Store JSON-LD nodes as `Y.Map` entries

```typescript
// JSON-LD node
const jsonldNode = {
  '@id': 'task-123',
  '@type': 'Task',
  'name': 'Buy groceries',
  'status': 'pending',
  'assignee': { '@id': 'user-456' }
};

// Store in Yjs
const nodes = ydoc.getMap('nodes');
nodes.set('task-123', jsonldNode); // Yjs handles nesting
```

**CRDT semantics**:

- **LWW (Last-Write-Wins)**: For primitive fields (`name`, `status`)
- **OR-Set**: For arrays (task lists)
- **Text**: For multi-paragraph fields (descriptions)

**Conflict example**:

```typescript
// Device A (offline): Change name
nodes.set('task-123', { ...task, name: 'Buy milk' });

// Device B (offline): Change status
nodes.set('task-123', { ...task, status: 'done' });

// After sync: Both changes apply (no conflict)
// Result: { name: 'Buy milk', status: 'done' }
```

### Sync Protocol

**State-based sync** (efficient for reconnection):

```typescript
// Device A: Send state vector (what I have)
const stateVector = Y.encodeStateVector(ydoc);
// → 29 bytes

// Device B: Compute diff (what you need)
const diff = Y.encodeStateAsUpdate(ydoc, stateVector);
// → Only missing operations (incremental)

// Device A: Apply diff
Y.applyUpdate(ydoc, diff);
// → Converged state
```

**Update-based sync** (real-time):

```typescript
ydoc.on('update', (update: Uint8Array) => {
  // Send update to peers via WebRTC/Relay
  network.broadcast(update);
});

// Peer receives update
network.on('message', (update: Uint8Array) => {
  Y.applyUpdate(ydoc, update);
});
```

### Persistence to OPFS

```typescript
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

const ydoc = new Y.Doc();

// Persist to IndexedDB (immediate)
const persistence = new IndexeddbPersistence('refarm-crdt', ydoc);

persistence.on('synced', () => {
  console.log('CRDT state loaded from IndexedDB');
});

// Updates auto-save to IndexedDB
ydoc.on('update', () => {
  // No manual save needed, y-indexeddb handles it
});
```

**Why IndexedDB instead of OPFS for CRDT?**

- IndexedDB is **optimized for structured data** (updates, state vectors)
- OPFS is for **SQLite database file** (JSON-LD nodes)
- Yjs ecosystem has mature IndexedDB provider
- Separation of concerns: CRDT state ≠ Application data

---

## Alternatives Considered

### Alternative 1: Automerge

**CRDT Type**: Operation-based, supports rich data types

**Pros**:

- JSON-native API (closer to JSON-LD)
- Excellent documentation
- Time-travel debugging

**Cons**:

- **5-18x slower** than Yjs (see benchmarks)
- **Larger bundle** (~200KB vs Yjs ~70KB)
- Immutable data model (harder to integrate with mutable frameworks)

**Rejected**: Performance critical for real-time collaboration

### Alternative 2: Gun.js

**CRDT Type**: Graph-based, peer-to-peer native

**Pros**:

- Built-in P2P networking
- Graph-oriented (semantic graph fit)

**Cons**:

- **Immature conflict resolution** (eventually consistent, not guaranteed convergence)
- Abandoned/sporadic maintenance
- Browser storage issues (quota exceeded)
- Security concerns (no sandboxing)

**Rejected**: Reliability and maintenance concerns

### Alternative 3: Custom CRDT

**Approach**: Implement LWW registers + OR-Sets from scratch

**Pros**:

- Full control over semantics
- Zero dependencies
- Optimized for JSON-LD

**Cons**:

- **High implementation cost** (months of work)
- **Correctness risks** (CRDT proofs are hard)
- **Missing ecosystem** (no providers, adapters)

**Rejected**: "Don't build what you can buy" (use proven library)

### Alternative 4: Operational Transform (OT)

**Approach**: Centralized server transforms operations

**Pros**:

- Proven (Google Docs uses OT)
- Deterministic ordering

**Cons**:

- **Requires central server** (violates offline-first)
- Complex transform functions
- Not peer-to-peer

**Rejected**: Conflicts with decentralized architecture

---

## Consequences

### Positive

1. **Battle-tested**: Yjs used in production by major apps
2. **Performance**: Fast enough for real-time collaboration
3. **Web Worker ready**: Sync in background without blocking UI
4. **Small bundle**: 70KB gzipped
5. **Ecosystem**: Providers for IndexedDB, WebRTC, WebSocket
6. **JSON-LD compatible**: Y.Map supports nested objects

### Negative

1. **Learning curve**: CRDT mental model different from traditional sync
2. **Last-Write-Wins semantics**: Field-level conflicts use timestamp (may surprise users)
3. **No schema validation**: Yjs doesn't enforce structure (must validate JSON-LD separately)
4. **Memory overhead**: CRDT metadata adds ~15-20% to data size

### Neutral

1. **IndexedDB for CRDT state**: Separate from SQLite (adds complexity, but clean separation)
2. **Binary format**: Updates are Uint8Array (not JSON) → harder to debug
3. **Clock synchronization**: Vector clocks handle out-of-order updates, but require incrementing

---

## Implementation Plan

### Phase 1: Core Integration (v0.1.0)

```typescript
// packages/sync-crdt/src/index.ts

import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';

export class SyncService {
  private ydoc: Y.Doc;
  private persistence: IndexeddbPersistence;
  
  constructor(vaultId: string) {
    this.ydoc = new Y.Doc();
    this.persistence = new IndexeddbPersistence(
      `refarm-crdt-${vaultId}`,
      this.ydoc
    );
  }
  
  // Get shared map for nodes
  getNodesMap(): Y.Map<any> {
    return this.ydoc.getMap('nodes');
  }
  
  // Get state vector for sync
  getStateVector(): Uint8Array {
    return Y.encodeStateVector(this.ydoc);
  }
  
  // Apply remote update
  applyUpdate(update: Uint8Array): void {
    Y.applyUpdate(this.ydoc, update);
  }
  
  // Subscribe to updates
  onUpdate(callback: (update: Uint8Array) => void): void {
    this.ydoc.on('update', callback);
  }
}
```

### Phase 2: Network Providers (v0.2.0)

- WebRTC provider (local P2P sync)
- WebSocket provider (Nostr relay sync)
- Conflict UI (show merge outcomes)

### Phase 3: Advanced Features (v0.3.0+)

- Undo/redo (Yjs built-in support)
- Awareness (show who's online)
- Selective sync (sync subgraphs only)

---

## Testing Strategy

```typescript
// Unit test: CRDT convergence
test('two devices converge after concurrent edits', () => {
  const doc1 = new Y.Doc();
  const doc2 = new Y.Doc();
  
  const map1 = doc1.getMap('nodes');
  const map2 = doc2.getMap('nodes');
  
  // Device 1: Edit field A
  map1.set('task-1', { name: 'Buy milk', status: 'pending' });
  
  // Device 2: Edit field B (concurrent)
  map2.set('task-1', { name: 'Buy groceries', done: true });
  
  // Exchange updates
  const update1 = Y.encodeStateAsUpdate(doc1);
  const update2 = Y.encodeStateAsUpdate(doc2);
  
  Y.applyUpdate(doc2, update1);
  Y.applyUpdate(doc1, update2);
  
  // Both converged (LWW for name, both fields present)
  expect(map1.get('task-1')).toEqual(map2.get('task-1'));
});
```

---

## References

- [Yjs Documentation](https://docs.yjs.dev/)
- [CRDT Benchmarks](https://github.com/dmonad/crdt-benchmarks)
- [Yjs Demos](https://demos.yjs.dev/)
- [Refarm Validation #2](../../docs/research/critical-validations.md#validação-2-crdt--opfs-quota-limite--confirmado)
