# ADR-045: Loro as the CRDT Engine (supersedes Yjs)

**Status**: Accepted
**Date**: 2026-03-17
**Deciders**: Core Team
**Supersedes**: [ADR-003 (Yjs)](ADR-003-crdt-synchronization.md)
**Implements**: [ADR-028 (CRDT-SQLite Convergence Strategy)](ADR-028-crdt-sqlite-convergence-strategy.md)
**Related**: [ADR-002 (Offline-First)](ADR-002-offline-first-architecture.md), [daemon_plan.md](../../daemon_plan.md)

---

## Context

[ADR-003](ADR-003-crdt-synchronization.md) adopted Yjs as the CRDT library. However, the actual
implementation remained a hand-written stub (`packages/sync-crdt/`) with `LWWRegister`, `ORSet`,
and `SyncEngine` — routing JSON-serialized operations without implementing real conflict resolution.
The comment at the top of that file explicitly listed Automerge and Yjs as references, signalling
it was always a placeholder.

[ADR-028](ADR-028-crdt-sqlite-convergence-strategy.md) (status: Proposed) described the target
architecture precisely: **the CRDT op-log is the source of truth; the SQL `nodes` table is a
materialized view**. This is the CQRS pattern applied to local-first sync.

The `SyncAdapter` interface in `@refarm.dev/sync-contract-v1` was already binary-ready:
`applyUpdate(Uint8Array)`, `getUpdate(): Promise<Uint8Array>`, `onUpdate(cb)`. `TractorConfig`
already has `sync?: SyncAdapter`. The infrastructure was waiting for the right engine.

In early 2026, [Loro](https://loro.dev) v1.0 reached stability, offering:

1. **Rust-core + WASM**: same binary in browser and daemon — no separate providers like Yjs needs
   (`y-indexeddb`, `y-websocket`, `y-webrtc`).
2. **`LoroTree`**: movable tree with concurrent move **cycle detection** — Yjs has no equivalent.
   Critical for plugin dependency graphs and `FarmhandTask` hierarchies.
3. **Shallow snapshots** (`mode: 'shallow-snapshot'`): analogous to `git clone --depth=1`.
   Essential for RPi/IoT targets (Farmhand Phase 2+) with constrained storage.
4. **Built-in time travel** (`doc.revertTo(frontiers)`, `doc.forkAt(frontiers)`): ADR-028 listed
   time-travel debugging as a goal; Loro delivers it at zero extra cost.
5. **`subscribeLocalUpdates(cb)`**: directly maps to the `SyncAdapter.onUpdate` contract.
6. **`import(bytes)` / `export({ mode })`**: directly maps to `applyUpdate` / `getUpdate`.

---

## Decision

**Adopt `loro-crdt` as the CRDT write model, paired with SQLite as the read model.**

This implements the ADR-028 CQRS architecture:

```
Write Model:  LoroDoc (CRDT, conflict-free merge, binary delta)
Read Model:   StorageAdapter (SQLite / memory, SQL-queryable)
Projector:    LoroDoc.subscribe → StorageAdapter.storeNode (microseconds, synchronous in practice)
```

### Isolation

Loro is contained in a single new package: `@refarm.dev/sync-loro`.
The rest of the stack (`@refarm.dev/tractor`, plugins, CLI, homestead) depends only on:
- `SyncAdapter` from `@refarm.dev/sync-contract-v1`
- `StorageAdapter` from `@refarm.dev/storage-contract-v1`

Swapping Loro for a different CRDT engine in the future means changing only `sync-loro`.

### New Package: `@refarm.dev/sync-loro`

```
packages/sync-loro/
├── src/
│   ├── loro-crdt-storage.ts   # LoroCRDTStorage: implements StorageAdapter + SyncAdapter
│   ├── projector.ts           # subscribes to LoroDoc, projects changes to read model
│   ├── browser-sync-client.ts # browser WebSocket client (connects to ws://localhost:42000)
│   └── index.ts
├── package.json
├── tsconfig.build.json        # TS-Strict (source is .ts)
└── tsconfig.json
```

### `LoroCRDTStorage` dual interface

```typescript
// Implements both contracts — passed as both storage: and sync: to Tractor.boot()
class LoroCRDTStorage implements StorageAdapter, SyncAdapter {
  // StorageAdapter.storeNode → writes to LoroDoc (write model)
  // StorageAdapter.queryNodes → delegates to read model SQLite
  // SyncAdapter.applyUpdate → LoroDoc.import(bytes) → Projector → SQLite
  // SyncAdapter.onUpdate → LoroDoc.subscribeLocalUpdates(cb)
  // SyncAdapter.getUpdate → LoroDoc.export({ mode: 'update' })
}
```

### CQRS Data Flow

```
Plugin calls tractor.storeNode(id, type, payload)
  ↓
LoroCRDTStorage.storeNode
  ↓
LoroDoc.getMap('nodes').set(id, JSON.stringify(node))
doc.commit()
  ↓
Projector.onChange (via doc.subscribe)
  ↓
readModel.storeNode(id, type, payload)   ← SQLite / memory

Query: queryNodes(type) → readModel.queryNodes(type) → SELECT * FROM nodes WHERE type = ?

Sync (farmhand daemon):
  doc.subscribeLocalUpdates(bytes → ws.broadcast(bytes))
  ws.onMessage(bytes → doc.import(bytes) → Projector → SQLite)

Sync (browser):
  BrowserSyncClient.connect() → ws://localhost:42000
  doc.subscribeLocalUpdates(bytes → ws.send(bytes))
  ws.onmessage(bytes → doc.import(bytes) → Projector → SQLite)
```

---

## Why Loro over Yjs (2026 evaluation)

| Feature | Yjs | Loro |
|---------|-----|------|
| Movable tree (cycle-safe) | ✗ Not available | ✓ `LoroTree` with cycle detection |
| Shallow snapshot | ✗ Not native | ✓ `mode: 'shallow-snapshot'` |
| Time travel / fork | ✗ Manual | ✓ `revertTo(frontiers)`, `forkAt()` |
| Single npm package | ✗ Ecosystem (y-websocket, y-indexeddb…) | ✓ `loro-crdt` covers all |
| Browser + daemon parity | ✗ Different providers per env | ✓ Same WASM binary |
| Core language | JavaScript | Rust (correctness, memory safety) |
| Bundle size (gzipped) | ~70 KB | ~200-400 KB (lazy-loadable) |
| Rich text (Fugue) | ✓ y-prosemirror | ✓ `LoroText` (Fugue algorithm) |

The bundle size difference is the primary trade-off. Loro is larger due to the Rust core. For the
browser, the WASM module is lazy-loaded on first sync — not in the critical rendering path.
For the daemon (farmhand), size is irrelevant.

---

## Migration from `sync-crdt` Stub

The existing `packages/sync-crdt/` (VectorClock, LWWRegister, ORSet, SyncEngine) is **preserved
as conceptual documentation** and removed from production sync paths. It served its purpose as a
teaching scaffold while the production architecture was being designed.

The `SyncTransport` interface in `sync-crdt` is **superseded** by the `SyncAdapter` interface in
`sync-contract-v1`, which is already binary-ready (`Uint8Array`).

The `WebSocketSyncTransport` in `apps/farmhand/` is simplified: JSON-serialized `CRDTOperation`
messages are replaced with raw `Uint8Array` binary frames (Loro delta updates).

---

## Consequences

### Positive

1. **Correct conflict resolution** — Loro's proven algorithms replace the stub
2. **Binary sync** — Uint8Array deltas are compact and transport-agnostic
3. **Zero breaking changes** — StorageAdapter, SyncAdapter, and plugin contracts unchanged
4. **CQRS correctness** — SQLite is always rebuildable from LoroDoc snapshot
5. **Time travel** — available at zero extra cost for future Studio history panel
6. **RPi-ready** — shallow snapshots enable Farmhand on constrained hardware
7. **LoroTree** — cycle-safe concurrent moves ready for plugin graphs when needed

### Negative

1. **Bundle size** — ~200-400 KB WASM for browser (mitigated by lazy loading)
2. **Oplog growth** — LoroDoc keeps full history; `shallow-snapshot` + periodic compaction needed
   for long-lived daemons
3. **Schema migration** — restructuring nodes (not adding fields) requires projector rebuild,
   like any CQRS read model migration

### Neutral

1. `packages/sync-crdt/` remains in the monorepo as a reference implementation
2. The projector runs synchronously in the same process (no eventual consistency lag in practice)

---

## Homage

This architecture would not be possible without the extraordinary work of the
**[loro-dev](https://github.com/loro-dev)** community. Their commitment to building
correct, ergonomic, and high-performance CRDTs in Rust — and making them accessible via WASM
to JavaScript ecosystems — is a gift to the local-first software movement.

Loro joins Refarm's constellation of sovereign inspirations. See [docs/INSPIRATIONS.md](../../docs/INSPIRATIONS.md).

---

## References

- [Loro documentation](https://loro.dev/docs/introduction)
- [loro-dev/loro (GitHub)](https://github.com/loro-dev/loro)
- [loro-crdt (npm)](https://www.npmjs.com/package/loro-crdt)
- [ADR-003 (Yjs — superseded)](ADR-003-crdt-synchronization.md)
- [ADR-028 (CRDT-SQLite convergence)](ADR-028-crdt-sqlite-convergence-strategy.md)
- [daemon_plan.md](../../daemon_plan.md) — Farmhand architecture and CRDT peer model
- [packages/sync-crdt/](../../packages/sync-crdt/src/index.ts) — stub preserved as reference
- [packages/sync-loro/](../../packages/sync-loro/) — implementation of this ADR
