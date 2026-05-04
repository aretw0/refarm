# ADR-061 — WASI Multi-Version Plugin Host

**Status:** Accepted  
**Date:** 2026-05-04  
**Author:** Arthur Silva  

## Context

Pi-agent is compiled with `cargo-component` targeting `wasm32-wasip1`, producing a WASM Component (Component Model binary) that runs on WASI Preview 1 host APIs. The tractor plugin host today supports only this path — `wasmtime::component::Component` + `bindgen!` WIT bindings.

The WASM ecosystem has three relevant layers:

| Layer | Binary kind | Target | Host API |
|---|---|---|---|
| **P1 (plain module)** | `wasmtime::Module` | `wasm32-wasi` / `wasm32-wasip1` | WASI snapshot1 ABI (function-level) |
| **P2 (component)** | `wasmtime::component::Component` | `wasm32-wasip1` + cargo-component, or `wasm32-wasip2` | WIT typed interfaces |
| **P3 (async component)** | Component + stack-switching | future `wasm32-wasip3` | Async WASI via component model |

A plugin ecosystem limited to one variant prevents:
- Third-party plugins built without `cargo-component` (plain C/Zig/Go modules)
- Future plugins targeting `wasm32-wasip2` or `wasm32-wasip3` directly
- Gradual migration as WASI matures without breaking existing plugins

## Decision

The tractor plugin host implements **automatic WASI variant detection** and maintains **separate loader paths** per variant. Plugin authors do not choose a loader — the host probes the binary and dispatches to the right path.

### Binary Probe

The first 8 bytes of a `.wasm` file uniquely identify its kind:

```
Module    (p1): 00 61 73 6d  01 00 00 00
Component (p2): 00 61 73 6d  0d 00 01 00
```

Byte 5 (0-indexed) is the "layer" discriminant:
- `0x01` → WASM module
- `0x0d` → WASM component

### Loader dispatch

```
probe_wasi_variant(bytes) → WasiVariant { Module | Component }
     │
     ├── Module   → ModuleLoader  (wasmtime::Module + preview1 ABI)
     └── Component → ComponentLoader  (current path, WIT bindgen!)
```

### P1 Module interface convention

Plain modules export a raw function interface (no WIT):

```
setup()                          → called once on load
on_event(ptr: i32, len: i32)     → JSON event in linear memory; response written to shared buffer
ingest()                         → optional data ingestion trigger
```

The host writes the JSON event to the module's linear memory, calls `on_event`, reads the response from a shared buffer region. This is the de facto convention for pre-WIT WASM plugin systems.

### P2 Component interface

Current path unchanged — `bindgen!` for `refarm-plugin-host` WIT world, typed calls via `on_event`, `setup`, `ingest`.

### P3 Async (future)

When wasmtime stabilises async component support (`wasm32-wasip3` or async WIT imports), a third loader path is added without changing the probe or the P1/P2 paths. Plugin manifests may declare `"wasi_version": "p3"` as a hint; the probe still takes precedence.

### Plugin manifest hint (optional)

```json
{ "wasi_version": "p1" | "p2" | "p3" }
```

Present only when the author wants to override or document the intent. The host logs a warning if the declared version mismatches the probed binary kind.

## Consequences

### What changes

1. `WasiVariant` enum + `probe_wasi_variant()` in new `host::wasi_variant` module.
2. `PluginHost::load_plugin` dispatches on probe result before instantiation.
3. `ModuleLoader` added for P1 plain modules (wasmtime::Module + preview1 linker).
4. Plugin manifest schema gains optional `wasi_version` field.
5. `plugin.json` integrity check happens before probe (unchanged).

### What does not change

- Pi-agent and all current Component Model plugins continue loading on the existing path.
- WIT bindings (`bindgen!`), `TractorStore`, `TractorNativeBindings` — unchanged.
- The effort/stream protocol (ADR-060) — runtime-agnostic.

### Invariants

1. A binary that is not a valid WASM module or component must fail to load with a descriptive error, not a panic.
2. P1 modules must not be able to access Component Model host imports (different linker).
3. The probe must complete in O(1) — read only the first 8 bytes.
4. Manifest `wasi_version` mismatch logs WARN but does not block load.

## Migration path

```
Today:   cargo-component → wasm32-wasip1 component   [tractor: ComponentLoader]
P1 gap:  clang/zig/go    → wasm32-wasi module        [tractor: ModuleLoader NEW]
Future:  cargo-component → wasm32-wasip2 component   [tractor: ComponentLoader, unchanged]
P3:      async WIT        → wasm32-wasip3 component  [tractor: AsyncComponentLoader]
```

## Related

- ADR-059: Tractor Rust as Authoritative Runtime
- ADR-060: HTTP Sidecar Protocol
- [Wasmtime WASI P1 docs](https://docs.wasmtime.dev/api/wasmtime_wasi/preview1/index.html)
- [Component Model binary format](https://github.com/WebAssembly/component-model/blob/main/design/mvp/Binary.md)
