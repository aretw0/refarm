# tractor (Rust) — Architecture

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

**Decision:** `tractor` IS the daemon. It does not sit alongside farmhand.

**Protocol:** Raw binary WebSocket frames = Loro update bytes. `BrowserSyncClient` in `packages/sync-loro/src/browser-sync-client.ts` requires zero changes — it already speaks this protocol.

### 5. Loro CRDT — `loro` Rust crate

**Binary compatibility:** `loro` (Rust) and `loro-crdt` (JS, `@1.10.7`) share the same binary update/snapshot format. A snapshot exported from a browser session can be imported by the native daemon and vice versa.

**CQRS architecture** (mirrors `LoroCRDTStorage` TS):
- **Write model:** `loro::LoroDoc` — conflict-free, binary delta
- **Read model:** `NativeStorage` (rusqlite) — SQL-queryable
- **Projector:** `doc.subscribe()` → writes changed nodes to read model

### 6. WIT bindings — `wasmtime::component::bindgen!` macro

Proc macro at compile time. No separate codegen step. Uses `wit/refarm-sdk.wit`, which is a symlink to `../../wit/refarm-sdk.wit` (the canonical source of truth). Changes to the WIT propagate automatically.

### 7. Deployment forms — lib + binary

- `[lib]` — embeddable in Electron, CLI, edge agents via `use tractor::TractorNative`
- `[[bin]]` — standalone daemon: `tractor --namespace default --port 42000`

### 8. Schema alignment — `crdt_log.id = TEXT PRIMARY KEY`, no `created_at`

**Decision (Phase 8):** Remove `nodes.created_at` and change `crdt_log.id` from
`INTEGER PRIMARY KEY AUTOINCREMENT` to `TEXT PRIMARY KEY`.

**Rationale:**
- `created_at` was never part of `PHYSICAL_SCHEMA_V1` in `packages/storage-sqlite`; its presence
  in the Rust schema caused `NativeStorage::open()` to fail on TS-created `.db` files.
- `INTEGER AUTOINCREMENT` for `crdt_log.id` creates silent merge conflicts: two peers generate
  `id=1` for different operations. CRDT IDs carry `peer_id/hlc_time` semantics and are globally
  unique by construction — `TEXT PRIMARY KEY` is the correct type.
- If `created_at` is needed in the future, derive it: `MIN(crdt_log.applied_at) WHERE node_id = ?`

**Verified by:** `tests/conformance.rs::schema_compat_ts_db_readable`

### 9. SecurityMode::Strict enforced in `PluginHost::load()`, not just in `TrustManager`

**Decision (Phase 8):** `PluginHost::load()` reads `trust.security_mode()` and rejects plugins
without a valid grant when `SecurityMode::Strict` is active. The check happens after SHA-256
hash computation but before wasmtime instantiation.

**Rationale:** Trust enforcement at the data layer (`TrustManager::has_valid_grant`) is
necessary but not sufficient. Without enforcement at `load()`, a caller with a `Strict`-mode
`TrustManager` could bypass the intent by constructing a `PluginHost` directly. Layered enforcement
matches defense-in-depth.

**API:** `TrustManager::with_security_mode(SecurityMode::Strict)` + `trust.grant(id, hash, None)`

**Verified by:** `tests/conformance.rs::security_mode_strict_rejects_untrusted_plugin`
               `tests/conformance.rs::security_mode_strict_allows_after_grant`

---

## TS ↔ Rust Capability Mapping

| TypeScript (`packages/tractor-ts`) | Rust (`packages/tractor`) | File |
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

## Graduation ✅ (ADR-048, 2026-03-19)

**tractor-native graduated to tractor.** All 6 criteria met (52/52 tests).

### Criteria (all met)

| # | Criterion | Status | Verification |
|---|---|---|---|
| 1 | All `cargo test -p tractor` pass | ✅ 52/52 | CI green |
| 2 | `BrowserSyncClient` interop (binary Loro roundtrip) | ✅ done | `loro_binary_js_interop` |
| 3 | `validations/simple-wasm-plugin` + `hello-world` load + execute | ✅ done | `plugin_lifecycle_setup_teardown` |
| 4 | Storage compat: TS `.db` readable by `NativeStorage` | ✅ done | `schema_compat_ts_db_readable` |
| 5 | Release binary footprint ≤30 MB | ✅ done | 27 MB stripped |
| 6 | All consumers of `@refarm.dev/tractor` identified | ✅ done | 4 apps + 8 packages — see Consumer Map below |

### Migration (completed)

1. ✅ `packages/tractor` → `packages/tractor-ts` (TS, npm name unchanged: `@refarm.dev/tractor`)
2. ✅ `packages/tractor-native` → `packages/tractor` (Rust canonical)
3. ✅ `Cargo.toml`: `name = "tractor"`, binary `name = "tractor"`
4. ✅ ADR-048 approved

---

## CLI & Plugin Startup

### Binary entry point — `src/main.rs`

`tractor` is a single-binary daemon produced by the `[[bin]]` target in
`Cargo.toml`. It parses CLI flags via `clap`, boots `TractorNative`, loads any
`--plugin` arguments, and then starts `WsServer` on the configured port.

**Startup sequence:**

```
1. Parse CLI args (clap)
2. Initialise tracing (log level from --log-level or RUST_LOG)
3. TractorNative::boot(config)          — opens storage, CRDT, plugin host, trust
4. for each --plugin <PATH>:            — isolated failure: WARN, continue
     tractor.load_plugin(path)
5. WsServer::new(...).start()           — blocks until Ctrl-C or fatal error
6. tractor.shutdown()                   — flush + close storage
```

### Known boot/runtime failure points (mapped)

| Stage | Failure point | Severity | Current behavior | Source |
|---|---|---|---|---|
| `TractorNative::boot` | SQLite open/schema/init failure | High | Boot fails fast (daemon does not start) | `src/lib.rs` (`NativeStorage::open`, `NativeSync::new`) |
| `PluginHost::new` | wasmtime engine/linker init failure | High | Boot fails fast | `src/host/plugin_host/env_and_runtime.rs` |
| `load_plugin` loop | Plugin file/hash/setup failure | Medium | Default: `WARN` + continue; with `--require-plugin-load`: fail-fast (startup exits) | `src/main.rs` `run_daemon` + `src/host/plugin_host/env_and_runtime.rs` |
| `WsServer::start` | Port bind/listen failure (`EADDRINUSE`, permissions) | High | Daemon exits with error | `src/daemon/ws_server.rs` |
| WS client frame handling | Invalid/corrupted incoming frame | Medium | Frame discarded, warning logged, daemon stays up | `src/daemon/ws_server.rs` |

Derived follow-up tasks from this map:
- `T-RUNTIME-05` — ✅ implemented: fail-fast policy via `--require-plugin-load`.
- `T-RUNTIME-06` — ✅ implemented: explicit startup/health probe (`tractor health`).
- `T-RUNTIME-04` — ✅ validated in controlled CRDT/storage roundtrip (`tests/sync_crdt.rs::offline_first_roundtrip_preserves_all_nodes`).

**CLI flags:**

| Flag | Default | Effect |
|---|---|---|
| `--namespace <NAME>` | `default` | SQLite path (`~/.local/share/refarm/<NAME>.db`) or `:memory:` |
| `--port <PORT>` | `42000` | TCP port for the WebSocket daemon |
| `--security-mode <MODE>` | `strict` | `strict` / `permissive` / `none` |
| `--log-level <LEVEL>` | `info` | `trace` / `debug` / `info` / `warn` / `error` |
| `--plugin <PATH>` | *(none)* | Load a WASM plugin at startup; repeatable |
| `--require-plugin-load` | `false` | Fail startup if any `--plugin` fails to load |
| `--ingest-on-load` | `false` | Call `ingest()` immediately after each plugin load (warn+continue on ingest failure) |
| `--require-plugin-ingest` | `false` | Fail startup when plugin `ingest()` fails (implies ingest-on-load) |

### Plugin loading semantics

`--plugin` may be specified multiple times. Plugins are loaded in declaration order
after `boot()` and before `WsServer::start()`.

Default policy is isolated failure (`WARN` + continue startup). When
`--require-plugin-load` is enabled, plugin load errors become startup-fatal
(fail-fast) and the daemon exits with non-zero status.

### Plugin lifecycle map (setup / ingest / teardown)

`T-RUNTIME-03` mapeia o lifecycle real no runtime nativo (`tractor`) com base no código e testes atuais.

| Stage | Fluxo atual | Evidência |
|---|---|---|
| `setup()` | O daemon chama `tractor.load_plugin(path)` no startup; `PluginHost::load()` instancia o componente WASM e executa `call_setup()` antes de retornar o handle. | `src/main.rs::run_daemon`, `src/lib.rs::TractorNative::load_plugin`, `src/host/plugin_host/env_and_runtime.rs::load` |
| `ingest()` | A primitiva existe via `PluginInstanceHandle::call_ingest()` e agora pode ser disparada no startup do daemon com `--ingest-on-load` (ou fail-fast com `--require-plugin-ingest`). | `src/main.rs::run_daemon`, `src/main.rs::maybe_ingest_on_load`, testes `tests/conformance.rs::plugin_ingest_roundtrip` e `src/main.rs::maybe_ingest_on_load_runs_with_plugin_fixture` |
| `teardown()` | O shutdown do daemon envia evento interno `__tractor:shutdown`, chama `teardown()` em cada runner e faz `join()` determinístico antes de fechar storage. | `src/lib.rs::TractorNative::shutdown`, `tests/plugin_shutdown.rs::shutdown_drains_plugin_channels_after_registration`, `src/host/instance.rs::call_teardown` |
| `on-event()` | Após load, o handle é movido para thread dedicada via `register_for_events`; eventos WS `user:prompt` são roteados para `call_on_event()`. | `src/lib.rs::register_for_events`, `src/daemon/ws_server.rs` |

### Gaps priorizados (runtime lifecycle)

| Gap | Prioridade | Impacto operacional | Hardening task derivada |
|---|---|---|---|
| `ingest()` não é executado no ciclo de vida do daemon (somente caminho manual/teste). | High | Plugins que dependem de ingest periódico ficam sem ciclo operacional padronizado. | `T-RUNTIME-08` ✅ implementada (trigger operacional via `--ingest-on-load` / `--require-plugin-ingest`) |
| `shutdown()` não garante `teardown()` explícito + drenagem coordenada das threads de plugin. | High | Risco de cleanup incompleto e semântica de encerramento inconsistente entre plugins. | `T-RUNTIME-07` ✅ implementada (evento interno de shutdown + teardown + join das runner threads) |
| Telemetria de lifecycle estruturada por fase estava ausente em setup/ingest/teardown. | Medium | Falhas de fase ficavam sem trilha objetiva para diagnóstico por plugin. | `T-RUNTIME-09` ✅ implementada (`plugin:lifecycle:start|end|error` com `plugin_id` + `phase`) |
| Runtime ainda não valida alinhamento manifesto↔instância (ex.: `plugin_id` efetivo, hooks declarados) no load. | Medium | Plugin inválido no ecossistema pode iniciar sem guard de contrato em runtime. | `T-RUNTIME-10` |

### Evidência de baseline executada (T-RUNTIME-03)

```bash
cargo test --test conformance plugin_ -- --nocapture
cargo test --test host_integration call_teardown_does_not_panic -- --nocapture
```

Resultado: ✅ `plugin_ingest_roundtrip`, `plugin_lifecycle_setup_teardown` e `call_teardown_does_not_panic` verdes no baseline.

Status de execução pós-mapeamento:
- ✅ `T-RUNTIME-07` concluída (shutdown coordenado com teardown explícito e drenagem de runner threads).
- ✅ `T-RUNTIME-08` concluída (trigger operacional de ingest no startup do daemon).
- ✅ `T-RUNTIME-09` concluída (telemetria estruturada de lifecycle com cobertura de teste).
- ⏭️ Gap remanescente priorizado: `T-RUNTIME-10`.

---

## Consumer Map — `@refarm.dev/tractor` (TS, `packages/tractor-ts`)

Packages and apps that import from `@refarm.dev/tractor` (npm name unchanged after graduation):

### Apps

| Consumer | Import | Notes |
|---|---|---|
| `apps/dev` | `Tractor` | graph.astro, index.astro, plugins.astro, shed.astro |
| `apps/farmhand` | `Tractor` | src/index.ts — daemon entrypoint |
| `apps/me` | `Tractor` | src/pages/index.astro |

### Packages

| Consumer | Imports | Notes |
|---|---|---|
| `packages/cli` | `Tractor` | plugin commands |
| `packages/homestead` | `Tractor`, `TelemetryEvent`, `TRACTOR_VERSION`, `L8nHost`, `TRACTOR_LOG_PRIORITY`, `SovereignNode` | Firefly, Herald, Shell |
| `packages/plugin-courier` | `Tractor` | also uses `test-utils` |
| `packages/plugin-tem` | `Tractor` | — |
| `packages/scarecrow` | `Tractor`, `SovereignNode` | — |
| `packages/sower` | `Tractor`, `SovereignNode` | browser + node variants |
| `packages/storage-rest` | doc reference | no runtime import |
| `packages/heartwood` | doc reference | WASM artifacts consumer |

Migration path: see [Graduation Strategy](#graduation-strategy).

---

## Consumer Integration Guide

### Choosing: Lib Crate vs Binary Daemon

| Use case | Recommendation |
|----------|---------------|
| Electron desktop app | `use tractor::TractorNative` (lib crate) — embed directly |
| CLI agent (no UI) | `use tractor::TractorNative` (lib crate) — or run binary as subprocess |
| Browser app (tractor-ts consumer) | Connect to the running `tractor` binary via WebSocket on port 42000 |
| IoT / RPi daemon | Run `tractor` binary standalone — zero Node.js needed |
| Integration tests | `TractorNativeConfig { namespace: ":memory:", .. }` — isolated, no disk state |

### Connecting via WebSocket (tractor-ts consumers)

The `BrowserSyncClient` in `packages/sync-loro/src/browser-sync-client.ts` connects to the daemon without changes:

```typescript
// packages/sync-loro — already speaks the binary Loro protocol
const client = new BrowserSyncClient('ws://localhost:42000');
await client.connect();
```

The protocol is raw binary WebSocket frames carrying Loro update bytes. All 7 consumers mapped above can transition from the farmhand daemon to the `tractor` binary with no client-side changes — only the server changes.

### tractor-ts ↔ tractor-rust Relationship

Both runtimes share:
- **Same WIT contracts** — `wit/refarm-sdk.wit` (plugins run on either without recompilation)
- **Same SQLite schema** — `PHYSICAL_SCHEMA_V1` (a `.db` from the TS runtime is readable by the Rust daemon; see `schema_compat_ts_db_readable` conformance test)
- **Same binary Loro format** — `loro-crdt` JS@1.10.7 ↔ `loro` Rust produce interoperable snapshots/deltas

**Migration path**: Any consumer currently using farmhand (the old Node.js daemon) can switch to `tractor` binary by changing the WebSocket endpoint from its previous port to `ws://localhost:42000`.

---

## Reference Files

| Purpose | Path |
|---|---|
| WIT contracts | `wit/refarm-sdk.wit` → symlink → `../../wit/refarm-sdk.wit` |
| TS plugin host | `packages/tractor/src/lib/plugin-host.ts` |
| TS WASI bridge | `packages/tractor/src/lib/wasi-imports.ts` |
| TS trust manager | `packages/tractor/src/lib/trust-manager.ts` |
| TS telemetry | `packages/tractor/src/lib/telemetry.ts` |
| TS storage (schema) | `packages/storage-sqlite/src/index.ts` |
| TS CRDT (CQRS) | `packages/sync-loro/src/loro-crdt-storage.ts` |
| TS WS client | `packages/sync-loro/src/browser-sync-client.ts` |
| Heartwood Rust pattern | `packages/heartwood/Cargo.toml` |
| Test WASM plugin | `validations/simple-wasm-plugin/` |
