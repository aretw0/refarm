# Phase 7 — Public API Specification (SDD)

> **SDD (Spec-Driven Development):** this document defines the behavioural contract
> *before* the implementation. Tests are derived from these invariants.

---

## 1. `TractorNative` — Root Aggregate

`TractorNative` is the root aggregate of the host context. It composes all bounded
contexts and exposes a single boot / shutdown lifecycle.

### 1.1 `TractorNative::boot(config: TractorNativeConfig) -> Result<TractorNative>`

**Pre-conditions:**
- `config.namespace` is a valid SQLite path or `:memory:`
- `config.port` is a valid TCP port (0–65535)

**Post-conditions (observable invariants):**
- Returns `Ok(tractor)` — no error on valid config
- `tractor.storage` is open and queryable
- `tractor.sync` is ready for `store_node` / `get_node`
- `tractor.plugins` is ready to load WASM components
- `tractor.trust` is initialised with the configured `SecurityMode`
- `tractor.telemetry` ring buffer is allocated with `config.telemetry_capacity` slots

**Isolation invariant:**
Two instances booted with `:memory:` share no state — each holds an independent
SQLite in-memory database and an independent `LoroDoc`.

### 1.2 `TractorNative::load_plugin(path: &Path) -> Result<PluginInstanceHandle>`

**Semantics:**
- Loads a WASM component from `path`
- Returns `Err(...)` if the file does not exist or is not a valid WASM component
- **Never panics** — error is isolated to this call; other plugins and subsystems
  remain operational
- A failed load does not affect subsequent calls to `load_plugin` with valid paths

**CLI integration:** when `--plugin <PATH>` is supplied (multiple accepted), each
path is loaded in declaration order after `boot()`. A load failure logs a `WARN`
and continues — it does NOT abort the daemon.

### 1.3 `TractorNative::shutdown() -> Result<()>`

**Semantics:**
- Flushes and closes `storage`
- Returns `Ok(())` on success, `Err(...)` on I/O failure
- Idempotent: calling shutdown twice must not panic (second call may return an error)

**Ordering contract:** plugins teardown before storage closes (future: explicit
`PluginHost::teardown_all()` hook — not yet enforced in Phase 7).

---

## 2. `TractorNativeConfig`

| Field | Type | Default | Effect |
|---|---|---|---|
| `namespace` | `String` | `"default"` | SQLite path under `~/.local/share/refarm/` or `:memory:` |
| `port` | `u16` | `42000` | TCP port for the WS daemon |
| `security_mode` | `SecurityMode` | `Strict` | Node signing + verification policy |
| `telemetry_capacity` | `usize` | `1000` | Ring buffer capacity for telemetry events |

---

## 3. CLI Flags (`tractor-native` binary)

```
tractor-native [OPTIONS]

Options:
  --namespace <NAME>        Storage namespace [default: default]
  --port <PORT>             WebSocket daemon port [default: 42000]
  --security-mode <MODE>    strict | permissive | none [default: strict]
  --log-level <LEVEL>       trace | debug | info | warn | error [default: info]
  --plugin <PATH>           Load a WASM plugin at startup (repeatable)
  -h, --help                Print help
```

### `--plugin <PATH>` semantics

- May be specified multiple times: `--plugin a.wasm --plugin b.wasm`
- Plugins are loaded **in declaration order** after `boot()` completes
- A load failure for one plugin emits `WARN` and continues to the next
- The daemon does **not** exit if all plugins fail — the WS server still starts
- Non-existent or non-WASM paths produce `Err` from `load_plugin` (logged as WARN)

---

## 4. Bounded Contexts

| Bounded Context | Rust Type | Responsibility |
|---|---|---|
| Host (root) | `TractorNative` | Boot / shutdown lifecycle, aggregate root |
| Sync | `NativeSync` | CRDT write + read models (Loro + SQLite CQRS) |
| Storage | `NativeStorage` | SQL read model, schema compat with TS |
| Trust | `TrustManager` | Plugin grants, `ExecutionProfile`, `SecurityMode` |
| Telemetry | `TelemetryBus` | Broadcast fan-out, ring buffer, field masking |
| Plugin execution | `PluginHost` | wasmtime Component loader + WIT bridge |

---

## 5. Ubiquitous Language

| Term | Definition |
|---|---|
| **Namespace** | Logical partition for storage; maps to a `.db` file or `:memory:` |
| **Node** | An atomic unit of domain data (URN-addressed, typed, CRDT-tracked) |
| **Plugin** | A WASM component implementing `refarm-sdk.wit` |
| **Trust grant** | An explicit permission issued to a plugin by the host |
| **Execution profile** | A capability set derived from trust grants (e.g. `ReadOnly`, `ReadWrite`) |
| **Telemetry event** | An observable side-effect emitted by a subsystem (stored in ring buffer) |
| **Update** | A Loro binary delta — portable between Rust and JS runtimes |
| **Snapshot** | A full Loro document export — deterministic, portable |

---

## 6. Error Taxonomy

| Error source | Expected behaviour |
|---|---|
| Invalid namespace (bad path) | `boot()` returns `Err` |
| Plugin file not found | `load_plugin()` returns `Err`; no panic |
| Plugin is not a valid WASM component | `load_plugin()` returns `Err`; no panic |
| Storage I/O failure on shutdown | `shutdown()` returns `Err` |
| CRDT import of invalid bytes | `apply_update()` returns `Err` |

---

## 7. Test Matrix (BDD scenarios → `tests/boot_integration.rs`)

| Scenario | Invariant verified |
|---|---|
| `boot_default_config_succeeds` | `boot()` with `:memory:` returns `Ok` |
| `boot_creates_sync_ready_to_store` | write→read cycle works after boot |
| `boot_shutdown_is_clean` | `shutdown()` returns `Ok`, no panic |
| `boot_two_instances_independent` | Two `:memory:` boots do not share state |
| `load_plugin_path_not_found_returns_error` | `load_plugin` returns `Err`, no panic |
