# tractor-native — Roadmap

> Vinculado ao roadmap principal: [`roadmaps/MAIN.md#tractor-native`](../../../roadmaps/MAIN.md#-rust-tractor-tractor-native)

**Versão alvo**: `0.1.0` (paridade comportamental com `@refarm.dev/tractor` TypeScript)
**Estratégia**: Lib embeddable + daemon WebSocket que substitui o farmhand na porta 42000
**Footprint alvo**: ~10 MB (sem Node.js / V8 / JCO)

---

## Estado atual

```
Fase 0–5 ✅  |  Fase 6–9 ⬜
```

| Fase | Status | Commit | Descrição |
|------|--------|--------|-----------|
| 0 — Scaffolding | ✅ | `337cf98` | Cargo.toml, estrutura modular, README, ARCHITECTURE.md |
| 1 — Storage | ✅ | `337cf98` | `NativeStorage` rusqlite, schema idêntico ao storage-sqlite TS |
| 2 — Trust | ✅ | `337cf98` | `TrustManager`, `TrustGrant`, `ExecutionProfile`, `SecurityMode` |
| 3 — Telemetria | ✅ | `337cf98` | `TelemetryBus` broadcast, `RingBuffer`, masking de campos sensíveis |
| 4 — Plugin Host | ✅ | `aa21e7b` | wasmtime `bindgen!`, `TractorNativeBindings`, 7 bridge fns, 19/19 testes |
| 5 — CRDT Sync | ✅ | `8245fd1` | `NativeSync` com `loro::LoroDoc`, CQRS Projector, 31/31 testes |
| 6 — WS Daemon | ⬜ | — | `WsServer` porta 42000, protocolo binário Loro |
| 7 — API Pública | ⬜ | — | `TractorNative::boot()`, `main.rs` CLI, release build |
| 8 — Conformance | ⬜ | — | Portar cenários vitest → `cargo test` |
| 9 — Docs finais | ⬜ | — | ARCHITECTURE.md finalizado, ADR entry |

**Testes atuais:** `cargo test -p tractor-native` → **31/31 ✅**

---

## Como retomar (entrada para nova sessão)

```bash
# 1. Verificar estado da resolução de pacotes
node scripts/reso.mjs status

# 2. Verificar estado de compilação
cargo check -p tractor-native

# 3. Rodar testes existentes
cargo test -p tractor-native

# 4. Ver próxima fase pendente neste arquivo
```

Continuar em: **[Fase 6 — WebSocket Daemon](#fase-6--websocket-daemon-tokio-tungstenite)**

---

## Fases — Especificação Detalhada

### Fase 4 — Plugin Host (wasmtime + WIT bindings)

**Arquivos a modificar:**
- `src/host/plugin_host.rs` — adicionar `bindgen!` macro + lógica real de carregamento
- `src/host/wasi_bridge.rs` — implementar trait `RefarmPluginImports` gerado pelo bindgen
- `src/host/instance.rs` — conectar ao `Store<TractorStore>` real do wasmtime

**Passos:**

1. **Adicionar `bindgen!` em `plugin_host.rs`:**
   ```rust
   wasmtime::component::bindgen!({
       world: "refarm-plugin",
       path: "wit",        // aponta para wit/refarm-sdk.wit
       async: true,
   });
   // Gera: RefarmPlugin (para chamar exports) + RefarmPluginImports trait (host implementa)
   ```

2. **Criar `TractorStore` struct** (estado do Store wasmtime):
   ```rust
   struct TractorStore {
       wasi: wasmtime_wasi::WasiCtx,
       bindings: TractorNativeBindings,
   }
   ```

3. **Criar Engine compartilhada** (cara para criar, deve ser `Arc<Engine>`):
   ```rust
   let mut config = Config::new();
   config.async_support(true);
   config.wasm_component_model(true);
   let engine = Engine::new(&config)?;
   ```

4. **Setup do Linker:**
   ```rust
   let mut linker: Linker<TractorStore> = Linker::new(&engine);
   wasmtime_wasi::add_to_linker_async(&mut linker, |s| &mut s.wasi)?;
   // Registrar tractor-bridge host functions:
   RefarmPlugin::add_to_linker(&mut linker, |s| &mut s.bindings)?;
   ```

5. **Carregar e instanciar o plugin:**
   ```rust
   let component = Component::from_file(&engine, path)?;
   let mut store = Store::new(&engine, TractorStore { wasi, bindings });
   let (plugin, _) = RefarmPlugin::instantiate_async(&mut store, &component, &linker).await?;
   plugin.call_setup(&mut store).await??;  // chama setup() export
   ```

6. **`PluginInstanceHandle` real:** armazenar `store + plugin` para chamadas futuras.

**Referências TS equivalentes:**
- `packages/tractor/src/lib/main-thread-runner.ts` — `instantiate()` com JCO
- `packages/tractor/src/lib/wasi-imports.ts` — `generate()` = o `TractorNativeBindings`

**Plugin de teste:**
```bash
# Verificar se o plugin de validação existe compilado
ls validations/simple-wasm-plugin/
ls validations/wasm-plugin/hello-world/
```

**Verificação:**
```bash
cargo test -p tractor-native host
# Deve carregar validations/simple-wasm-plugin/*.wasm e chamar setup()
```

**Desafios conhecidos:**
- O `wasmtime::component::bindgen!` pode gerar nomes em snake_case ligeiramente diferentes dos WIT kebab-case — verificar trait gerado antes de implementar
- O `WasiCtxBuilder` para `wasi:http/outgoing-handler` requer `wasmtime-wasi-http` separado com `AllowedOrigins`
- Fase 4 pode exigir atualizar o Cargo.toml com `wasmtime-wasi-http = "26"`

---

### Fase 5 — CRDT Sync (loro-rs + CQRS Projector)

**Arquivo:** `src/sync/loro.rs`

**Arquitetura CQRS** (espelha `LoroCRDTStorage` TS):
- Write model: `loro::LoroDoc` — conflict-free, binary delta
- Read model: `NativeStorage` (rusqlite) — SQL-queryable
- Projector: `doc.subscribe()` listener → chama `storage.store_node()` para cada nó mudado

**API pública de `NativeSync`:**
```rust
NativeSync::new(storage: NativeStorage, namespace: &str) -> Result<Self>
fn store_node(id, type_, context, payload, source_plugin) -> Result<()>
fn query_nodes(type_: &str) -> Result<Vec<NodeRow>>
fn apply_update(bytes: &[u8]) -> Result<()>   // doc.import(bytes)
fn get_update() -> Result<Vec<u8>>             // doc.export(Updates)
fn on_update(cb: impl Fn(Vec<u8>))            // subscribe_local_updates
fn export_snapshot() -> Result<Vec<u8>>
fn import_snapshot(bytes: &[u8]) -> Result<()>
fn rebuild_read_model() -> Result<()>          // reproject all nodes
```

**Atenção — API Loro Rust:**
O crate `loro` Rust pode ter nomes de métodos ligeiramente diferentes do JS.
Verificar docs: https://docs.rs/loro/latest/loro/

**Compatibilidade binária com loro-crdt JS:**
- Um snapshot exportado pelo browser via `doc.export({ mode: "snapshot" })` deve ser importável por `NativeSync::import_snapshot()`
- Verificar com teste de roundtrip: browser → export → arquivo → import nativo → query

**Verificação:**
```bash
cargo test -p tractor-native sync
# Teste: dois NativeSync em memória, store em um, roundtrip apply_update → query no outro
```

---

### Fase 6 — WebSocket Daemon (tokio-tungstenite)

**Arquivo:** `src/daemon/ws_server.rs`

**Protocolo** (idêntico ao farmhand existente):
- Frame binário WebSocket = bytes Loro update
- Ao conectar: envia estado atual via `sync.get_update()`
- Ao receber frame: `sync.apply_update(bytes)` → broadcast delta para outros clientes
- `BrowserSyncClient` TS **não precisa mudar** — já fala este protocolo

**Implementação com tokio-tungstenite:**
```rust
let listener = TcpListener::bind(format!("0.0.0.0:{port}")).await?;
let clients: Arc<Mutex<Vec<SplitSink<...>>>> = Arc::new(Mutex::new(vec![]));

while let Ok((stream, addr)) = listener.accept().await {
    let ws = tokio_tungstenite::accept_async(stream).await?;
    let (write, read) = ws.split();
    // Enviar estado atual
    write.send(Message::Binary(sync.get_update()?)).await?;
    // Spawn task para ler frames e aplicar updates
}
```

**Shutdown gracioso:**
```rust
tokio::select! {
    _ = tokio::signal::ctrl_c() => { tracing::info!("Shutdown"); }
    result = accept_loop => { result?; }
}
```

**Verificação:**
1. `cargo run -p tractor-native -- --namespace test` — inicia daemon
2. Abrir `@refarm.me/app` no browser — verifica que `BrowserSyncClient` conecta
3. Armazenar um nó no browser, verificar que aparece no SQLite do daemon
4. Armazenar no daemon, verificar que aparece no LoroDoc do browser

---

### Fase 7 — API Pública + main.rs CLI

**`src/lib.rs`** — `TractorNative::boot()` real (não stub):
- Inicializa Engine wasmtime (compartilhada, `Arc<Engine>`)
- Abre storage, cria NativeSync com peer_id derivado do namespace
- Aceita `IdentityAdapter` opcional (Phase 7+)

**`src/main.rs`** — CLI com clap:
```
tractor-native [OPTIONS]
  --namespace <NAME>       Storage namespace [default: "default"]
  --port <PORT>            WebSocket port [default: 42000]
  --security-mode <MODE>   strict | permissive | none [default: strict]
  --log-level <LEVEL>      trace | debug | info | warn | error [default: info]
  --plugin <PATH>          Carregar plugin .wasm ao iniciar (múltiplos aceitos)
```

**Verificação:**
```bash
cargo build --release -p tractor-native
ls -lh target/release/tractor-native   # alvo: ≤ 15 MB
./target/release/tractor-native --help
```

---

### Fase 8 — Conformance Tests

**Portar de:** `packages/tractor/src/lib/*.test.ts` (vitest)

**Cenários principais:**
- Carregar plugin, chamar `setup()` / `ingest()` / `teardown()` via wasmtime
- `store_node` → `query_nodes` roundtrip (via NativeSync + NativeStorage)
- `TrustManager::grant` / `revoke` / expiração (já feito)
- Roundtrip CRDT: `apply_update` → `project` → `query`
- `SecurityMode::Strict` — verificação de assinatura ed25519
- Compat de schema: abrir `.db` criado pelo TS `OPFSSQLiteAdapter`, verificar leitura

```bash
cargo test -p tractor-native
```

---

### Fase 9 — Documentação Final

- [ ] Atualizar `README.md` — marcar Fase 9 como ✅
- [ ] Finalizar `docs/ARCHITECTURE.md` com mapeamento TS↔Rust definitivo
- [ ] Escrever `specs/ADRs/ADR-047-tractor-native-rust-host.md`
- [ ] Atualizar `roadmaps/MAIN.md` — mover tractor-native de R&D para "In Progress → Done"
- [ ] Avaliar critérios de **graduação** (ver seção abaixo)

---

## Critérios de Graduação → `tractor`

Quando todos estes critérios forem atendidos, `tractor-native` se torna o `tractor` canônico:

| # | Critério | Como verificar |
|---|---|---|
| 1 | `cargo test -p tractor-native` — todos passam | CI verde |
| 2 | Interop `BrowserSyncClient` (roundtrip Loro binário) | Teste de integração |
| 3 | `validations/simple-wasm-plugin` + `hello-world` carregam e executam | `cargo test` ou manual |
| 4 | Compat de storage: `.db` TS legível pelo `NativeStorage` | Teste de schema |
| 5 | Binary release ≤ 15 MB | `ls -lh target/release/tractor-native` |
| 6 | Todos consumers de `@refarm.dev/tractor` mapeados | `grep -r "@refarm.dev/tractor" packages/ apps/` |

**Passos de migração:** ver `docs/ARCHITECTURE.md#graduation-strategy`

---

## Decisões Técnicas Relevantes

| Decisão | Escolha | Justificativa |
|---|---|---|
| Crypto | `ed25519-dalek` nativo + `SecurityMode` | Sempre disponível, opt-out via config; sem overhead WASM→WASM |
| SQLite | `rusqlite` (bundled) | Mesmo schema que TS; síncrono é adequado para calls de plugin |
| Async | `tokio` | Necessário para daemon WS + execução concorrente de plugins |
| WS daemon | Substitui farmhand na porta 42000 | `BrowserSyncClient` zero mudanças; menor complexidade |
| CRDT | `loro` Rust crate | Formato binário compatível com `loro-crdt` JS@1.10.7 |
| WIT bindings | `wasmtime::component::bindgen!` macro | Zero codegen manual; bindings gerados em compile time |
| Deploy | lib + binary | lib = Tauri/CLI/RPi; binary = daemon standalone |

---

## Arquivos de Referência

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
