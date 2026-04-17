# HANDOFF — Refarm Pi Agent Sprint

> Documento de continuidade de sessão. Se você é Claude em uma nova conversa:
> leia este arquivo inteiro antes de escrever qualquer código.
> Se você é Arthur: cole este arquivo no início da próxima sessão.

**Data:** 2026-04-17 | **Branch:** `develop` | **Autor da sessão:** Arthur + Claude Sonnet 4.6

---

## Estado atual do sprint

| Tarefa | Status | Arquivos-chave |
|--------|--------|----------------|
| 2A — `agent-tools` WASM | ✅ | `packages/agent-tools/` |
| 2B — tractor linker + composition | ✅ | `packages/tractor/src/host/` |
| 2B.5 — ws_server JSON routing | ✅ | `packages/tractor/src/daemon/ws_server.rs` |
| 2C — `pi-agent` scaffold | ✅ | `packages/pi-agent/` |
| **2C.1 — Multi-provider LLM via wasi:http** | ✅ | `packages/pi-agent/src/lib.rs` |
| **2D — UsageRecord audit + cache pricing** | ✅ | `packages/pi-agent/src/lib.rs` |
| 2E — Budget check + provider fallback | ⬜ próximo | `packages/pi-agent/` |
| 3 — Pi-Nano host em Zig | ⬜ sprint seguinte | |

---

## Commits entregues (todas as sessões)

```
d8950ef  feat(tractor): Tarefa 2B — agent-tools linker and composition pipeline
806b9cc  feat(agent-tools): scaffold agent-tools WASM component (Tarefa 2A)
```

*(2B.5, 2C e testes foram implementados na mesma sessão sem commit separado — committar antes de iniciar 2C.1)*

---

## Artefatos criados / modificados (sessão atual)

| Arquivo | O que é |
|---------|---------|
| `packages/tractor/src/lib.rs` | `AgentMessage`, `AgentChannels`, `register_for_events` |
| `packages/tractor/src/daemon/ws_server.rs` | Branch `Message::Text` → roteamento JSON de prompt; 5 testes |
| `packages/tractor/src/main.rs` | `Ok(handle) => register_for_events`; passa `agent_channels` ao WsServer |
| `packages/tractor/src/host/plugin_host.rs` | `.inherit_env()` no `WasiCtxBuilder` — LLM_PROVIDER etc chegam ao plugin |
| `packages/pi-agent/Cargo.toml` | cargo-component, wit-bindgen, serde_json, wasi |
| `packages/pi-agent/wit/world.wit` | World `pi-agent` em `refarm:plugin@0.1.0` |
| `packages/pi-agent/wit/refarm-plugin-host.wit` | Symlink → `packages/tractor/wit/host/refarm-plugin-host.wit` |
| `packages/pi-agent/src/lib.rs` | Pipeline completo + `mod provider` (Anthropic/Ollama/OpenAI-compat via wasi:http); 5 testes |

---

## Decisões arquiteturais (não reverter sem discussão)

### (Todas as decisões anteriores mantidas — ver sessão anterior)

### 6. wasi:http já está no host (Tarefa 2B)

`wasmtime_wasi_http::add_only_http_to_linker_async` é chamado em
`plugin_host.rs:112` e `TractorStore` já implementa `WasiHttpView`.
**Zero mudança necessária no tractor para 2C.1.** Só o plugin precisa ser modificado.

### 7. WIT multi-arquivo: apenas o primeiro arquivo com `package` pode ter `///` doc comment

O wit-parser trata qualquer comentário (`//` ou `///`) imediatamente antes de `package` como
doc-comment do pacote. Quando dois arquivos no mesmo diretório declaram o mesmo pacote
e ambos têm comentário antes de `package`, o parser rejeita com "found doc comments on multiple
package items". Solução: apenas o arquivo "principal" tem `///`; o `world.wit` abre direto com
`package` sem comentário anterior.

### 8. `refarm-sdk.wit` tem `type` no nível de pacote — inválido em wit-parser moderno

`refarm-sdk.wit` declara `type json-ld-node = string;` fora de qualquer interface.
Isso funcionava em versões antigas do wit-parser mas falha em wit-bindgen 0.36.
**Não usar `refarm-sdk.wit` como dep de WIT diretamente.** Usar `refarm-plugin-host.wit`
(packages/tractor/wit/host/) que encapsula os tipos dentro de `interface types { }`.

---

## Tarefa concluída: 2C.1 — Multi-provider LLM via wasi:http

### O que foi implementado

`packages/pi-agent/src/lib.rs` — `#[cfg(target_arch = "wasm32")] mod provider`:

| Provider | Env vars | Endpoint | Default model |
|----------|----------|----------|---------------|
| `anthropic` (default) | `ANTHROPIC_API_KEY` | `https://api.anthropic.com/v1/messages` | `claude-sonnet-4-6` |
| `ollama` | nenhuma | `http://localhost:11434/v1/chat/completions` | `llama3.2` |
| `openai` | `OPENAI_API_KEY` | `https://api.openai.com/v1/chat/completions` | `gpt-4o-mini` |

Variáveis de controle: `LLM_PROVIDER`, `LLM_MODEL`, `LLM_BASE_URL` (override de URL).

O host (tractor) usa `.inherit_env()` no `WasiCtxBuilder` — todos os env vars do processo chegam ao plugin sem enumeração manual.

### Validação de fumaça (browser dev console)
```javascript
const ws = new WebSocket('ws://localhost:42000');
ws.onmessage = e => {
  try { const n = JSON.parse(new TextDecoder().decode(e.data)); if (n?.['@type']==='AgentResponse') console.log('RESPONSE:', n) }
  catch { console.log('[crdt frame]') }
};
const ask = msg => ws.send(JSON.stringify({ type: 'user:prompt', agent: 'pi-agent', payload: msg }));
// ask('olá, quem és tu?')
// LLM_PROVIDER=ollama LLM_MODEL=llama3.2 cargo run -p tractor
```

---

## Próxima tarefa: 2D — Budget envelopes / cost governance

Inspirado em `aretw0/agents-lab`. Idéia central: soberania sobre custos, modelo e janela de contexto.

### O que fazer

1. **Envelope de orçamento** — limite mensal por provedor (env var ou config):
   ```
   LLM_BUDGET_ANTHROPIC_USD=5.00   # máximo USD/mês
   LLM_BUDGET_OLLAMA_USD=0         # grátis (local)
   ```

2. **Registro de uso** — após cada `react()`, armazenar um nó `UsageRecord`:
   ```json
   { "@type": "UsageRecord", "provider": "anthropic", "model": "claude-sonnet-4-6",
     "tokens_in": 42, "tokens_out": 128, "estimated_usd": 0.00045, "timestamp_ns": ... }
   ```

3. **Verificação pré-requisição** — antes de chamar o provider, verificar se o orçamento do período (30 dias) ainda tem saldo. Se não, retornar erro amigável.

4. **Fallback automático** — se Anthropic atingir budget, tentar Ollama local. Configurável via `LLM_FALLBACK_PROVIDER`.

5. **Janela de contexto** — `LLM_MAX_CONTEXT_TOKENS` como guard antes de enviar prompts longos (truncar ou resumir).

---

## Cobertura de testes atual

| Pacote / módulo | Testes | O que garante |
|-----------------|--------|---------------|
| `tractor` ws_server | 5 | Routing JSON 2B.5: happy path, agente desconhecido, JSON malformado, type errado, frame CRDT inicial |
| `tractor` agent_tools_bridge | 13 | agent-fs (read/write/edit), agent-shell (echo, exit code, argv, timeout, stdin, env) |
| `tractor` storage / sync / telemetry / trust | 18 | Camadas de base |
| `pi-agent` | 9 | Schema AgentResponse + UsageRecord (canários), pricing math + cache discount, react stub; todos nativos |
| **Total** | **45** | |

Para rodar tudo:
```bash
cargo test --manifest-path packages/tractor/Cargo.toml --lib
cargo test --manifest-path packages/pi-agent/Cargo.toml
```

---

## Referências críticas

| Recurso | Path | Por quê importa |
|---------|------|-----------------|
| Plugin host linker | `packages/tractor/src/host/plugin_host.rs:102-132` | wasi:http no linker (linha 112); `.inherit_env()` (linha 163) |
| WsServer JSON path | `packages/tractor/src/daemon/ws_server.rs:154-170` | Roteamento de prompt 2B.5 |
| Pi-agent pipeline | `packages/pi-agent/src/lib.rs:60-98` | handle_prompt + AgentResponse |
| Provider abstraction | `packages/pi-agent/src/lib.rs:118-305` | Anthropic/Ollama/OpenAI-compat via wasi:http |
| WIT válido (host) | `packages/tractor/wit/host/refarm-plugin-host.wit` | Usar este, não refarm-sdk.wit |
| ADR-050 | `specs/ADRs/ADR-050-zig-wasm-agent-tool-host.md` | Decisões Zig/zwasm + Pi-Nano |

---

## Como retomar a sessão com Claude

Cole no início da conversa:

> "Estou retomando o sprint do Pi Agent do refarm. Leia o HANDOFF.md na raiz e me diga o que está pronto, o que está pendente, e o que precisamos fazer agora."

---

> "Cultivamos o código como cultivamos o solo: com paciência, honestidade e respeito pelo ciclo."
