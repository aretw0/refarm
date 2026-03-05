# Sync (CRDT) - Roadmap

**Current Version**: v0.0.1-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## Overview

**sync-crdt** provides conflict-free synchronization via CRDT (Yjs):

- **Yjs** (proven CRDT library)
- **Network agnostic** (works with any transport)
- **Real-time collaboration** (operational transform)
- **Storage integration** (persist CRDT state)

**Responsibilities**:

- CRDT document management
- Conflict resolution (automatic, last-write-wins where needed)
- State synchronization across peers
- Persistence (CRDT state ↔ storage)
- Undo/redo history
- Awareness (presence, cursors for collaboration)

---

## v0.1.0 - Core CRDT
**Scope**: Yjs integration with local-first sync  
**Depends on**: storage v0.1.0 (persistence), kernel v0.1.0

### Pre-SDD Research

- [x] Validação #2: CRDT viability (Yjs validated)
- [ ] Test: Yjs + SQLite persistence performance
- [ ] Test: CRDT state size growth (JSON-LD docs)
- [ ] Test: Conflict resolution scenarios

### SDD (Spec Driven)

**Goal**: Define CRDT integration and sync protocol  
**Gate**: Specs complete, peer reviewed, no TODOs

- [ ] ADR-011: CRDT library choice (Yjs rationale)
- [ ] ADR-012: Sync protocol design
- [ ] Spec: SyncService interface
  - [ ] Document creation (Yjs.Doc)
  - [ ] Update application (receive remote changes)
  - [ ] State vector (track versions)
  - [ ] Delta encoding (efficient sync)
- [ ] Spec: Storage integration
  - [ ] Persist Yjs updates (append-only log)
  - [ ] Load document from storage
  - [ ] Compact/garbage collect old updates
- [ ] Spec: Conflict resolution rules
  - [ ] LWW (Last-Write-Wins) for primitives
  - [ ] Yjs automatic merge for collections

### BDD (Behaviour Driven)

**Goal**: Write integration tests that describe expected behavior (FAILING)  
**Gate**: Tests written (🔴 RED), peer reviewed

- [ ] E2E: Create Yjs document, apply local change, persist
- [ ] E2E: Load document from storage, verify state
- [ ] E2E: Two peers make conflicting changes, merge automatically
- [ ] E2E: Offline changes sync when connection restored
- [ ] E2E: Undo/redo local changes
- [ ] E2E: CRDT state persisted across restarts
- [ ] Acceptance: Sync is reliable, conflict-free, and local-first

### TDD (Test Driven)

**Goal**: Write unit tests for contracts (FAILING)  
**Gate**: Tests written (🔴 RED), coverage ≥80%

- [ ] Unit: Yjs document creation
- [ ] Unit: Update encoding/decoding
- [ ] Unit: State vector comparison
- [ ] Unit: Delta computation
- [ ] Unit: Persistence logic
- [ ] Coverage: >80%

### DDD (Domain Implementation)

**Goal**: Implement code until all tests PASS  
**Gate**: Tests GREEN (🟢), coverage met, changeset created

- [ ] Domain: SyncService class
- [ ] Domain: Document lifecycle (create, load, dispose)
- [ ] Domain: Update application
- [ ] Domain: State persistence (Yjs → Storage)
- [ ] Domain: Undo/redo manager
- [ ] Infra: Yjs integration
- [ ] Infra: Storage update provider (custom)
- [ ] Infra: IndexedDB provider (fallback)

### CHANGELOG

```
## [0.1.0] - YYYY-MM-DD
### Added
- Core SyncService with Yjs CRDT
- Local-first document synchronization
- Conflict-free merge (automatic)
- Persistent CRDT state (SQLite)
- Undo/redo support
```

---

## v0.2.0 - Network Sync
**Scope**: Peer-to-peer synchronization  
**Depends on**: identity-nostr v0.2.0 (peer discovery), kernel v0.2.0 (network)

### SDD (Spec Driven)

- [ ] Spec: Network sync protocol
  - [ ] Peer discovery (via Nostr relays)
  - [ ] WebRTC data channels (P2P sync)
  - [ ] WebSocket fallback (relay-based)
  - [ ] Sync initiation handshake
  - [ ] Delta exchange (state vectors)
- [ ] Spec: Connection management
  - [ ] Connect to peer
  - [ ] Disconnect gracefully
  - [ ] Reconnection strategy (exponential backoff)
  - [ ] Multiple peers (mesh network)

### BDD (Behaviour Driven)

- [ ] E2E: Two peers connect, sync documents
- [ ] E2E: Offline peer reconnects, catches up (delta sync)
- [ ] E2E: Three peers form mesh, all stay in sync
- [ ] E2E: Peer disconnects, others continue syncing
- [ ] E2E: Network partition resolves, documents merge
- [ ] Acceptance: Real-time collaboration works

### TDD (Test Driven)

- [ ] Unit: Peer connection logic
- [ ] Unit: Sync initiation protocol
- [ ] Unit: Delta exchange
- [ ] Unit: Reconnection strategy
- [ ] Coverage: >80%

### DDD (Domain Implementation)

- [ ] Domain: Network sync provider (Yjs)
- [ ] Domain: Peer connection manager
- [ ] Domain: Delta exchange protocol
- [ ] Infra: WebRTC integration (y-webrtc or custom)
- [ ] Infra: WebSocket provider (fallback)
- [ ] Infra: Nostr relay discovery

### CHANGELOG

```
## [0.2.0] - YYYY-MM-DD
### Added
- Peer-to-peer synchronization (WebRTC)
- WebSocket fallback for sync
- Mesh network support (multiple peers)
- Delta-based efficient sync
- Automatic reconnection
```

---

## v0.3.0 - Awareness & Presence
**Scope**: Real-time collaboration metadata  
**Depends on**: v0.2.0 (network sync)

### SDD (Spec Driven)

- [ ] Spec: Awareness protocol
  - [ ] Presence broadcast (online/offline)
  - [ ] User metadata (name, color, avatar)
  - [ ] Cursor positions (for rich text)
  - [ ] Selections (for collaborative editing)
- [ ] Spec: Ephemeral data
  - [ ] Not persisted (awareness is transient)
  - [ ] Timeout stale users (60s)

### BDD (Behaviour Driven)

- [ ] E2E: User joins, peers see presence
- [ ] E2E: User updates cursor, peers see in real-time
- [ ] E2E: User leaves, presence removed
- [ ] Acceptance: Collaboration feels real-time

### TDD (Test Driven)

- [ ] Unit: Awareness state management
- [ ] Unit: Timeout logic (stale users)
- [ ] Unit: Metadata broadcasting
- [ ] Coverage: >80%

### DDD (Domain Implementation)

- [ ] Domain: Awareness manager (Yjs.Awareness)
- [ ] Domain: Presence broadcasting
- [ ] Domain: Cursor/selection tracking
- [ ] Infra: Awareness protocol (Yjs built-in)

### CHANGELOG

```
## [0.3.0] - YYYY-MM-DD
### Added
- Real-time presence (online/offline)
- Cursor and selection sharing
- User metadata (name, color)
- Stale user timeout
```

---

## v0.4.0 - Advanced Conflict Strategies
**Scope**: Custom conflict resolution for JSON-LD  
**Depends on**: v0.3.0 (awareness stable)

### SDD (Spec Driven)

- [ ] Spec: Custom merge strategies
  - [ ] LWW with timestamp ties (identity-based tiebreak)
  - [ ] Field-level merge (different users edit different fields)
  - [ ] Priority-based merge (admin changes override)
- [ ] Spec: Conflict detection
  - [ ] Semantic conflicts (e.g., invalid JSON-LD)
  - [ ] User notification (conflict UI)

### BDD (Behaviour Driven)

- [ ] E2E: Two users edit same field, LWW wins
- [ ] E2E: Two users edit different fields, both merge
- [ ] E2E: Semantic conflict detected, user notified
- [ ] Acceptance: Conflicts are resolved intelligently

### TDD (Test Driven)

- [ ] Unit: LWW merge logic
- [ ] Unit: Field-level merge
- [ ] Unit: Conflict detection
- [ ] Coverage: >80%

### DDD (Domain Implementation)

- [ ] Domain: Custom merge strategies
- [ ] Domain: Conflict detector
- [ ] Domain: Conflict notification (event)
- [ ] Docs: Conflict resolution guide

### CHANGELOG

```
## [0.4.0] - YYYY-MM-DD
### Added
- Custom conflict resolution strategies
- Field-level merge support
- Semantic conflict detection
- Conflict notification system
```

---

## v1.0.0 - Production Ready
**Scope**: Performance, scalability, reliability  
**Depends on**: All features stable

### Quality Criteria

- [ ] Sync latency <100ms (local network)
- [ ] Sync latency <500ms (Internet, p95)
- [ ] Support 10+ simultaneous peers
- [ ] CRDT state size <2x original data
- [ ] Sync works across restarts (state recovery)
- [ ] No data loss on network partition

### SDD (Spec Driven)

- [ ] Spec: Performance optimization
  - [ ] CRDT state compression
  - [ ] Update batching
  - [ ] Lazy loading (large documents)
- [ ] Spec: Scalability
  - [ ] Subdocuments (isolate CRDT scopes)
  - [ ] Partial sync (sync only active docs)

### BDD (Behaviour Driven)

- [ ] E2E: 10 peers sync 1MB document in <5s
- [ ] E2E: Sync continues after browser restart
- [ ] E2E: Network disconnect/reconnect, no data loss
- [ ] Acceptance: Sync is production-grade

### TDD (Test Driven)

- [ ] Unit: State compression logic
- [ ] Unit: Update batching
- [ ] Benchmark: All quality criteria met
- [ ] Stress test: 100 peers, 10MB document
- [ ] Coverage: >85%

### DDD (Domain Implementation)

- [ ] Polish: Performance tuning (compression, batching)
- [ ] Polish: Error handling (network failures)
- [ ] Polish: Observability integration (sync metrics)
- [ ] Docs: API reference complete
- [ ] Docs: Sync architecture guide
- [ ] Docs: Performance tuning guide

### CHANGELOG

```
## [1.0.0] - YYYY-MM-DD
### Changed
- Performance optimizations (compression, batching)
- Enhanced network resilience
- Improved observability integration

### Fixed
- [All known sync issues addressed]
```

---

## Notes

- **Library**: Yjs is the clear choice (mature, proven, TypeScript-friendly)
- **Transport**: Network-agnostic (WebRTC preferred, WebSocket fallback)
- **Persistence**: Store Yjs updates (append-only), not full snapshots
- **Conflict Resolution**: Yjs automatic merge + custom strategies for JSON-LD semantics
- **Testing**: Focus on network partition scenarios and conflict resolution
- **Performance**: Target <100ms local sync, <500ms Internet sync
- **Scalability**: Use Yjs subdocuments for large graphs (isolate sync scopes)
