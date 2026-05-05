# Sync-Loro (CRDT Engine) - Roadmap

**Current Version**: v0.1.0-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

> Version headings below are capability horizons, not release commitments. Until Refarm is a daily driver, post-`v0.1.0` items remain backlog labels and must be prioritized only when they improve the daily-driver path.

---

## v0.1.0 - Binary Interop (DONE)

**Scope**: Establish the binary-compatible sync bridge between JS (loro-crdt) and Rust (loro-rs).  
**Depends on**: `loro-dev` community crates (@1.10.x).

### SDD (Spec Driven) ✅

- [x] Spec: `LoroCRDTStorage` CQRS Projector pattern.
- [x] Spec: Binary transport protocol over WebSocket (port 42000).
- [x] Spec: SQLite schema compatibility for CRDT materialization.

### BDD (Behaviour Driven) ✅

- [x] Integration: Loro binary delta roundtrip (JS↔Rust).
- [x] Integration: CRDT state correctly materialized into SQLite tables.
- [x] Integration: Offline mutations on Browser synced back to Tractor on reconnect.

### TDD (Test Driven) ✅

- [x] Unit: `LoroDoc` snapshot and delta encoding/decoding.
- [x] Unit: Projector mapping logic (Doc → SQL).
- [x] Coverage: >85%

### DDD (Domain Implementation) ✅

- [x] Domain: Core `Sync-Loro` TypeScript client.
- [x] Infra: WebSocket client and binary message handling.

---

## v0.2.0 - P2P & Discovery Integration

**Scope**: Enabling direct peer-to-peer sync without a central relay.

- [ ] Implementation of **mDNS Discovery**: Finding other local Refarm instances to sync Loro deltas over LAN.
- [ ] **Conflict Resolution Policies**: User-defined rules for resolving multi-device conflicts (e.g. "Device A wins" or "Manual merge").
- [ ] Integration with `creek` for sync health telemetry.

---

## v0.3.0 - Performance & Pruning

**Scope**: Managing the long-term history of the Sovereign Graph.

- [ ] Implementation of **Shallow Snapshots**: Initial sync as `git clone --depth=1` to save bandwidth on mobile.
- [ ] **State Pruning**: Strategically removing old history deltas to preserve storage while maintaining consistency.

---

## Notes

- See [packages/sync-loro/src/loro-crdt-storage.ts](./src/loro-crdt-storage.ts) for core logic.
- `BrowserSyncClient` remains schema-neutral: it transports Loro binary updates and must not special-case `AgentResponse`, `StreamChunk`, or `StreamSession`; stream rendering belongs in the UI subscriber that reads materialized Tractor nodes.
- The "Blood" of the sovereign farm — ensuring information flows consistently across all nodes.
