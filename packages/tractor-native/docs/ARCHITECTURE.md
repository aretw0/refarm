# tractor-native — Architecture

## Purpose

Native Rust replacement for `@refarm.dev/tractor` (TypeScript).
Eliminates the V8 / JCO transpilation layer for edge, server, and RPi deployments.

## Design Decisions

### 1. Crypto — `ed25519-dalek` native, `SecurityMode` opt-out

**Decision:** Link `ed25519-dalek` directly (not load heartwood.wasm via wasmtime).

**Rationale:** Cryptography is a host primitive, not a plugin feature. Loading heartwood.wasm would add WASM→WASM call overhead for every node signature — the most frequent security operation. The question "can we skip crypto?" is answered at config level via `SecurityMode::None`, not by making crypto removable as a plugin.

**`SecurityMode` values:**
- `Strict` — all nodes signed; signature failures are errors (default)
- `Permissive` — nodes signed; verification failures are warnings
- `None` — no signing/verification (dev, air-gapped, or pre-identity scenarios)

### 2. SQLite — `rusqlite` with `bundled` feature

**Decision:** `rusqlite` (synchronous) with `features = ["bundled"]`.

**Rationale:** The `bundled` feature compiles libsqlite3 into the binary, ensuring the ~10 MB self-contained footprint. wasmtime's plugin calls are synchronous from the host perspective (async over tokio), so synchronous SQLite within a `spawn_blocking` is appropriate.

**Schema compatibility:** `PHYSICAL_SCHEMA_V1` is identical to `packages/storage-sqlite/src/index.ts`. A `.db` file written by either implementation is readable by the other.

### 3. Async runtime — `tokio`

Required for the WebSocket daemon and concurrent plugin execution. The host itself is `async`; individual plugin calls are dispatched on `spawn_blocking` or dedicated tasks per plugin.

### 4. WebSocket protocol — replaces farmhand on port 42000

**Decision:** `tractor-native` IS the daemon. It does not sit alongside farmhand.

**Protocol:** Raw binary WebSocket frames = Loro update bytes. `BrowserSyncClient` in `packages/sync-loro/src/browser-sync-client.ts` requires zero changes — it already speaks this protocol.

### 5. Loro CRDT — `loro` Rust crate

**Binary compatibility:** `loro` (Rust) and `loro-crdt` (JS, `@1.10.7`) share the same binary update/snapshot format. A snapshot exported from a browser session can be imported by the native daemon and vice versa.

**CQRS architecture** (mirrors `LoroCRDTStorage` TS):
- **Write model:** `loro::LoroDoc` — conflict-free, binary delta
- **Read model:** `NativeStorage` (rusqlite) — SQL-queryable
- **Projector:** `doc.subscribe()` → writes changed nodes to read model

### 6. WIT bindings — `wasmtime::component::bindgen!` macro

Proc macro at compile time. No separate codegen step. Uses `wit/refarm-sdk.wit` (copy of `../../wit/refarm-sdk.wit`).

> **Note:** Keep `packages/tractor-native/wit/refarm-sdk.wit` in sync with `/workspaces/refarm/wit/refarm-sdk.wit`. A future improvement: use a git submodule or build script symlink.

### 7. Deployment forms — lib + binary

- `[lib]` — embeddable in Tauri, CLI, edge agents via `use tractor_native::TractorNative`
- `[[bin]]` — standalone daemon: `tractor-native --namespace default --port 42000`

---

## TS ↔ Rust Capability Mapping

| TypeScript (`packages/tractor`) | Rust (`packages/tractor-native`) | File |
|---|---|---|
| `@bytecodealliance/jco` transpile | `wasmtime::component::Component::from_file()` | `host/plugin_host.rs` |
| `MainThreadRunner.instantiate()` | `RefarmPlugin::instantiate_async()` | `host/plugin_host.rs` |
| `WorkerRunner` | `tokio::spawn` / `spawn_blocking` | `host/plugin_host.rs` |
| `WasiImports.generate()` | `WasiCtxBuilder` + `linker.instance(...)` | `host/wasi_bridge.rs` |
| `wasi:logging/logging` | `wasmtime_wasi` built-in | — |
| `wasi:http/outgoing-handler` | `wasmtime-wasi-http` + origin allowlist | `host/wasi_bridge.rs` |
| `wasi:clocks/wall-clock` | `wasmtime_wasi` built-in | — |
| `wasi:random/random` | `wasmtime_wasi` built-in | — |
| `TrustManager` (class) | `TrustManager` (struct) | `trust/mod.rs` |
| `ExecutionProfile` | `ExecutionProfile` (enum) | `trust/mod.rs` |
| `SecurityMode` | `SecurityMode` (enum) | `trust/mod.rs` |
| `StorageAdapter` (SQL) | `NativeStorage` (rusqlite) | `storage/sqlite.rs` |
| `LoroCRDTStorage` (loro-crdt JS) | `NativeSync` (loro Rust) | `sync/loro.rs` |
| `Projector` | Projector (inside NativeSync) | `sync/loro.rs` |
| `BrowserSyncClient` (WS client) | `WsServer` (replaces farmhand) | `daemon/ws_server.rs` |
| `TelemetryHost` (EventEmitter) | `TelemetryBus` (broadcast) | `telemetry/mod.rs` |
| `TelemetryRingBuffer` | `RingBuffer<TelemetryEvent>` | `telemetry/mod.rs` |
| `@noble/ed25519` | `ed25519-dalek` | `lib.rs` |
| `PluginInstanceHandle` | `PluginInstanceHandle` | `host/instance.rs` |
| `PluginState` | `PluginState` (enum) | `host/instance.rs` |
| `Tractor.boot()` | `TractorNative::boot()` | `lib.rs` |
| `Tractor.shutdown()` | `TractorNative::shutdown()` | `lib.rs` |

---

## Graduation Strategy

**tractor-native → tractor** when all graduation criteria are met:

### Criteria

| # | Criterion | Verification |
|---|---|---|
| 1 | All `cargo test -p tractor-native` pass | CI green |
| 2 | `BrowserSyncClient` interop (binary Loro roundtrip) | Integration test |
| 3 | `validations/simple-wasm-plugin` + `hello-world` load + execute | `cargo test` or manual |
| 4 | Storage compat: TS `.db` readable by `NativeStorage` | Schema test |
| 5 | Release binary ≤ 15 MB | `ls -lh target/release/tractor-native` |
| 6 | All consumers of `@refarm.dev/tractor` identified | `grep -r "@refarm.dev/tractor"` audit |

### Migration Steps

1. Rename `packages/tractor` → `packages/tractor-ts`
2. Rename `packages/tractor-native` → `packages/tractor`
3. Update `Cargo.toml`: `name = "tractor"`, binary `name = "tractor"`
4. Update npm `package.json`: `"name": "@refarm.dev/tractor"`
5. Add deprecation notice to `packages/tractor-ts/README.md`
6. Write `docs/adr/ADR-XXX-tractor-native-graduation.md`
7. Commit: `feat(tractor)!: graduate tractor-native as canonical tractor implementation`

---

## Reference Files

| Purpose | Path |
|---|---|
| WIT contracts | `wit/refarm-sdk.wit` (copy of `../../wit/refarm-sdk.wit`) |
| TS plugin host | `packages/tractor/src/lib/plugin-host.ts` |
| TS WASI bridge | `packages/tractor/src/lib/wasi-imports.ts` |
| TS trust manager | `packages/tractor/src/lib/trust-manager.ts` |
| TS telemetry | `packages/tractor/src/lib/telemetry.ts` |
| TS storage (schema) | `packages/storage-sqlite/src/index.ts` |
| TS CRDT (CQRS) | `packages/sync-loro/src/loro-crdt-storage.ts` |
| TS WS client | `packages/sync-loro/src/browser-sync-client.ts` |
| Heartwood Rust pattern | `packages/heartwood/Cargo.toml` |
| Test WASM plugin | `validations/simple-wasm-plugin/` |
