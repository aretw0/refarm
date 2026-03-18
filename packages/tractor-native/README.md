# tractor-native

Sovereign WASM plugin host — native Rust implementation of the Refarm Tractor.

Provides full behavioral parity with `@refarm.dev/tractor` (TypeScript), with:
- **~10 MB** binary footprint (no Node.js / V8)
- **wasmtime** WASM Component Model host (no JCO transpilation)
- **rusqlite** with the same schema as `packages/storage-sqlite`
- **loro** Rust CRDT engine (binary-compatible with `loro-crdt` JS)
- **WebSocket daemon** on port 42000 (replaces farmhand — `BrowserSyncClient` unchanged)
- **Embeddable lib** for Tauri, CLI agents, RPi

## How to Build

```bash
cargo build -p tractor-native
cargo test  -p tractor-native
cargo build --release -p tractor-native   # ~10 MB binary
```

## How to Run

```bash
# Start daemon (replaces farmhand on port 42000)
./target/release/tractor-native --namespace default --port 42000

# Development mode (no signing)
./target/release/tractor-native --security-mode none --log-level debug
```

---

## Roadmap

Roadmap detalhado com especificações por fase, desafios conhecidos, e critérios de graduação:
**[docs/ROADMAP.md](docs/ROADMAP.md)**

Vinculado ao roadmap principal do projeto: **[roadmaps/MAIN.md](../../roadmaps/MAIN.md)**

---

## Session Continuity — Phase Checklist

**To resume from a new chat / agent:**
1. Read this file and the phase checklist below
2. Run `node scripts/reso.mjs status` (verify resolution mode)
3. Run `cargo check -p tractor-native` (see compile state)
4. Read `docs/ARCHITECTURE.md` for design rationale
5. Continue from the next `[ ]` phase

**At end of each session:** update the checkboxes below and commit:

```
docs(tractor-native): session checkpoint — phases X-Y complete
```

### Phases

- [x] Phase 0 — Scaffolding: Cargo.toml, stub modules, README, ARCHITECTURE.md
- [x] Phase 1 — Storage: `NativeStorage` (rusqlite + PHYSICAL_SCHEMA_V1)
- [x] Phase 2 — Trust: `TrustManager`, `TrustGrant`, `ExecutionProfile`, `SecurityMode`
- [x] Phase 3 — Telemetry: `TelemetryBus` (broadcast fan-out), `RingBuffer`, sensitive masking
- [x] Phase 4 — Plugin Host: wasmtime `Component` loading, `bindgen!` WIT bindings, `TractorNativeBindings`
- [ ] Phase 5 — CRDT Sync: `NativeSync` with `loro::LoroDoc` + CQRS Projector
- [ ] Phase 6 — WebSocket Daemon: `WsServer` on port 42000 (tokio-tungstenite, binary Loro frames)
- [ ] Phase 7 — Public API: `TractorNative::boot()`, `main.rs` CLI args, release build
- [ ] Phase 8 — Conformance Tests: port vitest scenarios to `cargo test`
- [ ] Phase 9 — Documentation: `docs/ARCHITECTURE.md` finalized, ADR entry

### Next Session Entry Point

**Continue at: Phase 5 — CRDT Sync**

Key files to read before starting Phase 5:
- `src/sync/loro.rs` — stub NativeSync (delegates to storage; Loro not yet wired)
- `packages/sync-loro/src/loro-crdt-storage.ts` — TS equivalent (CQRS pattern)
- `packages/sync-loro/src/browser-sync-client.ts` — WS binary protocol

Phase 5 key steps:
1. Add `loro::LoroDoc` wrapped in `Arc<Mutex<>>` to `NativeSync`
2. Implement Projector: `doc.subscribe()` → write to rusqlite read model
3. Wire `store_node()` through LoroDoc (write model) → Projector → rusqlite
4. `apply_update()` / `get_update()` — binary Loro delta frames (compatible with JS loro-crdt@1.10.7)
5. Test CRDT roundtrip: two NativeSync instances, exchange updates, verify convergence

Phase 4 completion state (19/19 tests ✅):
- `wit/host/refarm-plugin-host.wit` — host-side world without WASI deps
- `bindgen!` in `plugin_host.rs` with `path: "wit/host"`, `world: "refarm-plugin-host"`
- `TractorNativeBindings` implements `refarm::plugin::tractor_bridge::Host` (7 bridge fns)
- `PluginInstanceHandle` holds real `RefarmPluginHost` + `Store<TractorStore>`
- `tests/fixtures/null-plugin.wasm` — pre-compiled Component fixture

---

## Graduation to `tractor`

When all phases are complete and graduation criteria are met, `tractor-native` becomes `tractor`:
- See `docs/ARCHITECTURE.md#graduation-strategy` for criteria and migration steps
- TS package archived as `@refarm.dev/tractor-ts`
- This crate renamed to `tractor`, binary renamed to `tractor`
