# sync-crdt — Superseded

> **Status**: Superseded by `@refarm.dev/sync-loro` (ADR-045, 2025-01-28).
>
> This package is no longer the active CRDT implementation.
> Git history contains the full Yjs-based design that preceded this decision.

---

## What Happened

**ADR-003** originally adopted Yjs for CRDT synchronization, with CRDT state stored in
IndexedDB separately from application data in SQLite/OPFS.

**ADR-045** replaced that approach:

| Before (ADR-003) | After (ADR-045) |
|---|---|
| Yjs | Loro CRDT engine |
| IndexedDB (separate CRDT log) | SQLite/OPFS (co-located with data) |
| `y-indexeddb` persistence | Loro binary snapshot + delta columns |
| WebRTC/WebSocket via y-webrtc/y-websocket | `stream-contract-v1` transport adapters |

**Reasons for the switch** (see [ADR-045](../../specs/ADRs/ADR-045-loro-crdt-adoption.md)):

- Loro stores binary deltas alongside application data in the same SQLite file — no
  separate storage layer to keep in sync
- Smaller delta sizes and snapshot import/export enable recovery via CQRS replay
- Single source of truth eliminates the CRDT-state ↔ data drift class of bugs

---

## Active Package

Use **`@refarm.dev/sync-loro`** for all CRDT work:

- Binary deltas, state vectors, snapshot import/export
- CQRS projector for replay-based recovery
- Wired to `stream-contract-v1` transports (File, SSE, WebSocket)

See [sync-loro ROADMAP](../sync-loro/ROADMAP.md) and
[ADR-045](../../specs/ADRs/ADR-045-loro-crdt-adoption.md).
