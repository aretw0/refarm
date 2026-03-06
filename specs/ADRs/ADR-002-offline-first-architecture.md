# ADR-002: Offline-First Architecture

**Status**: Accepted  
**Date**: 2026-03-06  
**Deciders**: Core Team  
**Related**: [ADR-003 (CRDT)](ADR-003-crdt-synchronization.md), [ADR-009 (OPFS)](ADR-009-opfs-persistence-strategy.md)

---

## Context

Refarm is a Personal Operating System for managing sovereign data. Users must be able to work without internet connectivity, with network being purely optional for synchronization and plugin discovery.

**Core requirements**:

1. **All data lives locally**: SQLite via OPFS in browser
2. **Network is optional**: App boots and functions completely offline
3. **Sync when available**: Changes propagate when network restored
4. **No server dependency**: No backend, no database server, no auth server
5. **Progressive enhancement**: Network adds collaboration, not core functionality

**Challenge**: How do we architect components to ensure offline is the default, not an afterthought?

---

## Decision

**We adopt a layered architecture with explicit data flow: Storage → Sync → Network**

### Core Principle: "Storage is Truth"

```
┌──────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                           │
│                     (apps/studio - Astro)                        │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                      KERNEL (Orchestration)                      │
│  - Service registry                                              │
│  - Event bus                                                     │
│  - Lifecycle management                                          │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                   ┌─────────┴─────────┐
                   ▼                   ▼
         ┌─────────────────┐   ┌─────────────────┐
         │   STORAGE       │   │   IDENTITY      │
         │  (SQLite+OPFS)  │   │   (Nostr keys)  │
         │                 │   │                 │
         │ - CRUD ops      │   │ - Keypair mgmt  │
         │ - JSON-LD       │   │ - Signing       │
         │ - Migrations    │   │ - Local only    │
         └────────┬────────┘   └────────┬────────┘
                  │                     │
                  └──────────┬──────────┘
                             ▼
                   ┌─────────────────┐
                   │      SYNC       │
                   │   (CRDT - Yjs)  │
                   │                 │
                   │ - Conflict res  │
                   │ - Local state   │
                   │ - Offline queue │
                   └────────┬────────┘
                            │
                   ┌────────┴────────┐
                   ▼                 ▼
         ┌─────────────┐   ┌─────────────┐
         │   NETWORK   │   │  PLUGINS    │
         │  (optional) │   │   (WASM)    │
         │             │   │             │
         │ - WebRTC    │   │ - Sandboxed │
         │ - Nostr     │   │ - Offline OK│
         │ - Matrix    │   └─────────────┘
         └─────────────┘
         
         ↑ THIS LAYER CAN FAIL WITHOUT BREAKING APP
```

### Data Flow Rules

#### 1. Write Path (User → Storage)

```
User action → Kernel → Storage (immediate write) → Sync (queue) → Network (when available)
```

- **Storage writes are synchronous**: User sees data immediately
- **CRDT updates async**: Prepares changes for sync
- **Network push deferred**: Happens when connection exists

**Example**: User creates a task

```typescript
// 1. Storage layer (immediate, offline-capable)
const nodeId = await storage.insert({
  '@type': 'Task',
  'name': 'Buy groceries',
  'created': new Date().toISOString()
});

// 2. Sync layer (queues CRDT update)
sync.queueUpdate({
  type: 'insert',
  nodeId,
  timestamp: vectorClock.increment()
});

// 3. Network layer (sends when online)
if (network.isOnline()) {
  await network.push(sync.getPendingUpdates());
}
```

#### 2. Read Path (Storage → User)

```
User query → Kernel → Storage (local read) → UI render
```

- **No network dependency**: Reads always from local SQLite
- **Fast**: Sub-millisecond query times (indexed)
- **Complete**: All user data is local

#### 3. Sync Path (Network → Storage)

```
Network pull → Sync (CRDT merge) → Storage (apply changes) → UI update
```

- **Conflict-free**: CRDT handles merges automatically
- **Incremental**: Only transmits deltas (state vectors)
- **Resilient**: Can handle hours/days offline, syncs when back

### Offline Capability Matrix

| Feature | Offline | Online | Notes |
|---------|---------|--------|-------|
| **View data** | ✅ Full | ✅ Full | Always from local storage |
| **Create/edit** | ✅ Full | ✅ Full | Storage → queue → sync later |
| **Delete** | ✅ Full | ✅ Full | Tombstone in CRDT |
| **Search** | ✅ Full | ✅ Full | SQLite FTS5 |
| **Plugins** | ✅ Most | ✅ All | WASM works offline, network calls fail gracefully |
| **Sync changes** | ❌ | ✅ | Queued locally, applies when online |
| **Discover plugins** | ❌ | ✅ | Nostr NIP-89 requires relay |
| **Install plugin** | ⚠️ Cached | ✅ | If WASM cached, works offline |
| **Multi-device** | ❌ | ✅ | Requires WebRTC or relay |

### Offline-First Guarantees

1. **Zero network calls on boot**: App starts instantly from OPFS
2. **All writes succeed**: Storage never returns "network error"
3. **Read-your-writes**: User sees their changes immediately
4. **Sync queue persists**: Offline edits don't drop, they queue and batch
5. **Graceful degradation**: Network features show "offline" state, don't crash

---

## Implementation Strategy

### Phase 1: Storage Foundation (v0.1.0)

- SQLite + OPFS adapter
- CRUD operations
- No network at all (proves offline-first)

### Phase 2: Sync Layer (v0.1.0)

- Yjs CRDT integration
- Local conflict resolution
- Sync queue (persisted in SQLite)

### Phase 3: Network Layer (v0.2.0)

- WebRTC P2P (local sync)
- Nostr relay (identity + plugin discovery)
- Online/offline state management

### Phase 4: Network Abstraction (v0.2.0)

- Matrix federation (optional)
- Pluggable transports
- Automatic failover (WebRTC → Relay → Matrix)

---

## Alternatives Considered

### Alternative 1: Online-First (Traditional SaaS)

**Architecture**: Frontend → API → Database

**Pros**:

- Simpler mental model
- Server-side validation
- Cross-device sync "for free"

**Cons**:

- **Fails our core requirement**: Network becomes dependency
- User can't work on plane, subway, rural areas
- Privacy concern: data lives on server first
- Vendor lock-in: can't take data without server

**Rejected**: Violates "Radical Ejection Right" and sovereignty principles

### Alternative 2: Hybrid (Optimistic UI + Server)

**Architecture**: Frontend caches + Backend as source of truth

**Pros**:

- Works offline temporarily
- Familiar pattern (Google Docs, Notion)

**Cons**:

- Cache invalidation complexity
- Server still required for conflict resolution
- "Offline" is an afterthought, not the core
- Doesn't work long-term without network

**Rejected**: Doesn't satisfy "No server dependency" requirement

### Alternative 3: Local-First with Sync Service

**Architecture**: Local DB + Sync service (like CouchDB, PouchDB)

**Pros**:

- True local-first
- Proven technology (CouchDB replication)

**Cons**:

- Still requires sync server (even if self-hosted)
- CouchDB's HTTP API adds latency
- PouchDB abandoned, CouchDB complex to operate
- Doesn't solve decentralized plugin marketplace

**Rejected**: Sync service becomes single point of failure

### Chosen: CRDT + P2P + Optional Relays

**Pros**:

- True peer-to-peer (no required server)
- CRDT handles conflicts mathematically
- WebRTC for local sync (fast)
- Nostr relays for discovery (decentralized)
- Works 100% offline indefinitely

**Cons**:

- More complex sync logic (CRDT learning curve)
- P2P NAT traversal challenges (mitigated by relay fallback)

---

## Consequences

### Positive

1. **User privacy**: Data never leaves device unless user initiates sync
2. **Performance**: Local reads/writes are instant (no network latency)
3. **Reliability**: App always works, never shows "server error"
4. **Portability**: User owns data, can export SQLite file anytime
5. **Cost**: Zero server costs, zero scaling issues

### Negative

1. **Storage limits**: OPFS quota (~100GB, browser-dependent)
2. **Sync complexity**: CRDT merge logic required
3. **Collaboration UX**: Multi-device requires explicit sync action (not automatic like cloud)
4. **Backup responsibility**: User must backup their data (export feature required)

### Neutral

1. **Browser-only**: Not a native app (but PWA provides install experience)
2. **Plugin distribution**: Requires internet for initial download (cached after)

---

## Testing Strategy

### Unit Tests

- Storage: CRUD operations without Sync/Network layers
- Sync: CRDT merges with mocked Storage
- Network: Connection handling with mocked relays

### Integration Tests

- **Offline mode**: Disable network, verify all features work
- **Queue persistence**: Write offline, restart, verify queue survives
- **Sync reconciliation**: Create conflicts, verify CRDT resolves correctly

### E2E Tests (Playwright)

```javascript
test('app works completely offline', async ({ page, context }) => {
  // Block all network requests
  await context.route('**/*', route => route.abort());
  
  // App should still boot
  await page.goto('/');
  await expect(page.locator('.kernel-status')).toHaveText('Ready');
  
  // User can create data
  await page.fill('[name="task"]', 'Offline task');
  await page.click('[type="submit"]');
  
  // Data visible immediately
  await expect(page.locator('.task-list')).toContainText('Offline task');
  
  // Restart (reload page)
  await page.reload();
  
  // Data persists
  await expect(page.locator('.task-list')).toContainText('Offline task');
});
```

---

## References

- [Local-First Software](https://www.inkandswitch.com/local-first/) (Ink & Switch)
- [Offline First](https://offlinefirst.org/)
- [CRDT Theory](https://crdt.tech/)
- [OPFS Spec](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API)
- Production examples: Obsidian, Logseq, Figma (offline mode)
