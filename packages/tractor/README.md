# tractor (Rust)

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
cargo build -p tractor
cargo test  -p tractor
cargo build --release -p tractor   # ~27 MB binary
```

## Development (inside Dev Container)

**Memory constraints:** The dev container runs with ~7.6 GB RAM (WSL2). `wasmtime v26` is one of
the heaviest crates in the ecosystem (~1–2 GB RAM per compilation unit). Two mitigations are in
place:

- `.cargo/config.toml` caps parallel jobs at 6 (default is `nproc = 16`)
- `[profile.dev] debug = 1` uses line-tables-only DWARF (saves ~40% RAM vs full debug info)
- `rust-analyzer.check.command` is set to `"check"` (not `"clippy"`) to avoid background recompilation

**Never run these in parallel inside the container:**

```bash
# Correct — run separately
cargo test -p tractor -- --test-threads=1
cargo clippy -p tractor

# Avoid — triggers simultaneous compilation of all targets
cargo test --all
```

## How to Run

```bash
# Start daemon (replaces farmhand on port 42000)
./target/release/tractor --namespace default --port 42000

# Development mode (no signing)
./target/release/tractor --security-mode none --log-level debug
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
3. Run `cargo check -p tractor` (see compile state)
4. Read `docs/ARCHITECTURE.md` for design rationale
5. Continue from the next `[ ]` phase

**At end of each session:** update the checkboxes below and commit:

```
docs(tractor): session checkpoint — phases X-Y complete
```

### Phases

- [x] Phase 0 — Scaffolding: Cargo.toml, stub modules, README, ARCHITECTURE.md
- [x] Phase 1 — Storage: `NativeStorage` (rusqlite + PHYSICAL_SCHEMA_V1)
- [x] Phase 2 — Trust: `TrustManager`, `TrustGrant`, `ExecutionProfile`, `SecurityMode`
- [x] Phase 3 — Telemetry: `TelemetryBus` (broadcast fan-out), `RingBuffer`, sensitive masking
- [x] Phase 4 — Plugin Host: wasmtime `Component` loading, `bindgen!` WIT bindings, `TractorNativeBindings`
- [x] Phase 5 — CRDT Sync: `NativeSync` with `loro::LoroDoc` + CQRS Projector
- [ ] Phase 6 — WebSocket Daemon: `WsServer` on port 42000 (tokio-tungstenite, binary Loro frames)
- [ ] Phase 7 — Public API: `TractorNative::boot()`, `main.rs` CLI args, release build
- [ ] Phase 8 — Conformance Tests: port vitest scenarios to `cargo test`
- [ ] Phase 9 — Documentation: `docs/ARCHITECTURE.md` finalized, ADR entry

### Next Session Entry Point

**Continue at: Phase 6 — WebSocket Daemon**

Key files to read before starting Phase 6:
- `src/daemon/ws_server.rs` — WebSocket listener on port 42000
- `packages/sync-loro/src/browser-sync-client.ts` — WS binary protocol
- `src/sync/loro.rs` — completed NativeSync with LoroDoc and Projector

Phase 6 key steps:
1. Setup `tokio::net::TcpListener` on port 42000
2. Accept WebSocket connections via `tokio-tungstenite`
3. Send initial state to each client via `sync.get_update()`
4. Receive binary Loro frames and apply via `sync.apply_update()`
5. Broadcast deltas to all connected clients
6. Graceful shutdown with `tokio::signal::ctrl_c()`

Phase 5 completion state (31/31 tests ✅):
- `wit/host/refarm-plugin-host.wit` — host-side world without WASI deps
- `bindgen!` in `plugin_host.rs` with `path: "wit/host"`, `world: "refarm-plugin-host"`
- `TractorNativeBindings` implements `refarm::plugin::tractor_bridge::Host` (7 bridge fns)
- `PluginInstanceHandle` holds real `RefarmPluginHost` + `Store<TractorStore>`
- `tests/fixtures/null-plugin.wasm` — pre-compiled Component fixture

---

## Graduation ✅

`tractor-native` graduated to `tractor` (ADR-048, 2026-03-19). All 52 tests pass.
- TS package moved to `packages/tractor-ts` (npm name unchanged: `@refarm.dev/tractor`)
- This crate: `packages/tractor`, crate name `tractor`, binary `tractor`
