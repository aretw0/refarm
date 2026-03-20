# tractor-native — Domain Model

> DDD artefact for Phase 7. Maps bounded contexts, aggregates, value objects,
> and ubiquitous language across TypeScript ↔ Rust ↔ business domain.

---

## Bounded Contexts

```
┌───────────────────────────────────────────────────────────┐
│  Host Context  (TractorNative — root aggregate)           │
│                                                           │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐ │
│  │    Sync     │  │   Storage   │  │  Plugin Execution│ │
│  │ NativeSync  │  │NativeStorage│  │   PluginHost     │ │
│  │(LoroDoc +   │  │(rusqlite    │  │(wasmtime + WIT   │ │
│  │  Projector) │  │ read model) │  │    bridge)       │ │
│  └─────────────┘  └─────────────┘  └──────────────────┘ │
│                                                           │
│  ┌─────────────┐  ┌──────────────────────────────────┐   │
│  │    Trust    │  │         Telemetry                │   │
│  │TrustManager │  │       TelemetryBus               │   │
│  │(grants +    │  │(broadcast fan-out + RingBuffer)  │   │
│  │  profiles)  │  └──────────────────────────────────┘   │
│  └─────────────┘                                         │
└───────────────────────────────────────────────────────────┘
```

---

## Aggregates & Entities

### `TractorNative` (Root Aggregate)

- **Identity:** `namespace` (maps to storage path)
- **Lifecycle:** `boot()` → `[running]` → `shutdown()`
- **Responsibilities:** compose bounded contexts; expose `load_plugin`, `shutdown`

### `NativeSync` (Sync BC — Aggregate Root)

- **Write model:** `loro::LoroDoc` — conflict-free replicated data type
- **Read model:** `NativeStorage` (SQL projection via `Projector`)
- **Key operations:** `store_node`, `get_node`, `query_nodes`, `apply_update`,
  `get_update`, `export_snapshot`, `import_snapshot`

### `TrustManager` (Trust BC — Aggregate Root)

- **State:** `HashMap<PluginId, TrustGrant>`
- **Key operations:** `grant`, `revoke`, `is_authorized`, `get_profile`

### `PluginHost` (Plugin Execution BC — Aggregate Root)

- **State:** wasmtime `Engine` (shared, `Arc`), `Linker`, active instances
- **Key operations:** `load(path, sync)` → `PluginInstanceHandle`

---

## Value Objects

| Value Object | Rust Type | Invariants |
|---|---|---|
| Node ID | `String` (URN) | Non-empty, globally unique within namespace |
| Node type | `String` | Domain-specific label (e.g. `"Note"`, `"Task"`) |
| Payload | `String` (JSON) | Valid UTF-8; content is domain-defined |
| Security mode | `SecurityMode` | `Strict` / `Permissive` / `None` — immutable after boot |
| Execution profile | `ExecutionProfile` | Derived from trust grants; `ReadOnly` / `ReadWrite` / `Admin` |
| Loro update | `Vec<u8>` | Binary Loro delta — portable across Rust and JS runtimes |
| Loro snapshot | `Vec<u8>` | Full doc export — deterministic, portable |

---

## Ubiquitous Language

| Term | Definition |
|---|---|
| **Namespace** | Logical storage partition; `":memory:"` for ephemeral / test |
| **Node** | Atomic unit of domain data — URN-addressed, typed, CRDT-tracked |
| **Plugin** | WASM component implementing `refarm-sdk.wit`; loaded by `PluginHost` |
| **Trust grant** | Explicit permission record issued to a plugin by the host |
| **Execution profile** | Capability set derived from trust grants |
| **Telemetry event** | Observable side-effect emitted by a subsystem |
| **Update (Loro)** | Binary delta between two doc states — sync primitive |
| **Snapshot (Loro)** | Complete doc state export — migration / backup primitive |
| **Projector** | Component that translates CRDT mutations → SQL read model |
| **Boot** | Full lifecycle initialisation of all subsystems; produces a ready host |
| **Shutdown** | Orderly teardown: flush storage, release resources |

---

## Cross-Language Alignment

| Business concept | TypeScript (`packages/tractor`) | Rust (`packages/tractor-native`) |
|---|---|---|
| Host aggregate | `Tractor` class | `TractorNative` struct |
| Sync BC | `LoroCRDTStorage` | `NativeSync` |
| Storage read model | `OPFSSQLiteAdapter` | `NativeStorage` |
| Trust BC | `TrustManager` class | `TrustManager` struct |
| Plugin execution BC | `MainThreadRunner` / `WorkerRunner` | `PluginHost` |
| Telemetry BC | `TelemetryHost` (EventEmitter) | `TelemetryBus` (broadcast) |
| Boot | `Tractor.boot(config)` | `TractorNative::boot(config)` |
| Shutdown | `tractor.shutdown()` | `tractor.shutdown().await` |
| Node storage | `adapter.storeNode(...)` | `sync.store_node(...)` |
| Node retrieval | `adapter.getNode(id)` | `sync.get_node(id)` |
