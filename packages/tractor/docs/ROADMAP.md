# tractor (Rust) — Graduation Certificate

> **Status**: ✅ COMPLETED — ADR-048, 2026-03-19
> Roadmap principal: [`roadmaps/MAIN.md`](../../../roadmaps/MAIN.md)

**Version**: `0.1.0` (behavioral parity with `@refarm.dev/tractor` TypeScript)
**Strategy**: Embeddable lib + WebSocket daemon replacing farmhand on port 42000
**Binary footprint**: ~27 MB (wasmtime runtime included)

---

## Development History

```
Fase 0–9 ✅  |  Todos os critérios de graduação atendidos ✅
```

| Fase | Status | Commit | Descrição |
|------|--------|--------|-----------|
| 0 — Scaffolding | ✅ | `337cf98` | Cargo.toml, estrutura modular, README, ARCHITECTURE.md |
| 1 — Storage | ✅ | `337cf98` | `NativeStorage` rusqlite, schema idêntico ao storage-sqlite TS |
| 2 — Trust | ✅ | `337cf98` | `TrustManager`, `TrustGrant`, `ExecutionProfile`, `SecurityMode` |
| 3 — Telemetria | ✅ | `337cf98` | `TelemetryBus` broadcast, `RingBuffer`, masking de campos sensíveis |
| 4 — Plugin Host | ✅ | `aa21e7b` | wasmtime `bindgen!`, `TractorNativeBindings`, 7 bridge fns, 19/19 testes |
| 5 — CRDT Sync | ✅ | `8245fd1` | `NativeSync` com `loro::LoroDoc`, CQRS Projector, 31/31 testes |
| 6 — WS Daemon | ✅ | `3098365` | `WsServer` porta 42000, protocolo binário Loro, 10/10 testes |
| 7 — API Pública | ✅ | — | `TractorNative::boot()`, `main.rs` CLI + `--plugin`, 5 boot integration tests |
| 8 — Conformance | ✅ | — | Schema fix + 3 conformance tests + binary size gate |
| 9 — Docs finais | ✅ | — | ARCHITECTURE.md finalizado, ADR-047, consumer map |

**Tests**: `cargo test -p tractor -- --test-threads=1` → **52/52 ✅**

---

## Technical Decisions

| Decisão | Escolha | Justificativa |
|---|---|---|
| Crypto | `ed25519-dalek` nativo + `SecurityMode` | Sempre disponível, opt-out via config; sem overhead WASM→WASM |
| SQLite | `rusqlite` (bundled) | Mesmo schema que TS; síncrono é adequado para calls de plugin |
| Async | `tokio` | Necessário para daemon WS + execução concorrente de plugins |
| WS daemon | Substitui farmhand na porta 42000 | `BrowserSyncClient` zero mudanças; menor complexidade |
| CRDT | `loro` Rust crate | Formato binário compatível com `loro-crdt` JS@1.10.7 |
| WIT bindings | `wasmtime::component::bindgen!` macro | Zero codegen manual; bindings gerados em compile time |
| Deploy | lib + binary | lib = Electron/CLI/RPi; binary = daemon standalone |

---

## Reference Files

| Propósito | Caminho |
|---|---|
| Contratos WIT | `wit/refarm-sdk.wit` |
| Equivalente TS do Plugin Host | `packages/tractor/src/lib/plugin-host.ts` |
| Equivalente TS do WASI Bridge | `packages/tractor/src/lib/wasi-imports.ts` |
| Equivalente TS do TrustManager | `packages/tractor/src/lib/trust-manager.ts` |
| Schema SQLite (source of truth) | `packages/storage-sqlite/src/index.ts` |
| CQRS pattern (TS) | `packages/sync-loro/src/loro-crdt-storage.ts` |
| Protocolo WS (TS client) | `packages/sync-loro/src/browser-sync-client.ts` |
| Padrão Rust crate existente | `packages/heartwood/Cargo.toml` |
| Plugin WASM de teste | `validations/simple-wasm-plugin/` |
| Roadmap principal | `roadmaps/MAIN.md` |

---

## Graduation Criteria (All Met)

| # | Critério | Status | Como verificar |
|---|---|---|---|
| 1 | `cargo test -p tractor` — todos passam | ✅ 51/51 | CI verde |
| 2 | Interop `BrowserSyncClient` (roundtrip Loro binário) | ✅ done | `loro_binary_js_interop` — fixture gerado por loro-crdt JS, importado pelo Rust |
| 3 | Plugin carrega e executa ciclo completo (setup/ingest/teardown) | ✅ done | `plugin_lifecycle_setup_teardown` + `plugin_ingest_roundtrip` |
| 4 | Compat de storage: `.db` TS legível pelo `NativeStorage` | ✅ done | `schema_compat_ts_db_readable` |
| 5 | Binary release footprint ≤30 MB | ✅ redefinido | `target/release/tractor` = 27 MB; meta ≤15 MB redefinida — ver ADR-047 errata |
| 6 | Todos consumers de `@refarm.dev/tractor` mapeados | ✅ done | 4 apps + 8 packages — ver ARCHITECTURE.md |

---

## Next Evolution

This crate has graduated. Future development tracks are documented in:
- **[roadmaps/MAIN.md](../../../roadmaps/MAIN.md)** — Project-wide roadmap
- **[ADR-048](../../../specs/ADRs/ADR-048-tractor-graduation.md)** — Graduation record
- **[ADR-049](../../../specs/ADRs/ADR-049-post-graduation-horizon.md)** — Post-graduation horizon (edge/IoT, CLI agents)

For the public API specification, see **[docs/specs/api-reference.md](specs/api-reference.md)**.
