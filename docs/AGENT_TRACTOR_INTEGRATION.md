# Agent → Tractor Integration Guide

Este documento descreve o fluxo completo de como um agente (pi-agent ou qualquer plugin WASM) despacha trabalho, consome LLMs e persiste resultados via Tractor. É a referência canônica para agentes autônomos que precisam entender como o sistema funciona end-to-end.

**ADRs relacionados**: ADR-052, ADR-053, ADR-054, ADR-055

---

## Visão geral da arquitetura

```
┌──────────────────────────────────────────────────────────────┐
│  Browser / CLI                                               │
│  refarm task run pi-agent respond --args '{"prompt":"..."}'  │
└────────────────────┬─────────────────────────────────────────┘
                     │ Effort file (.json)
                     ▼
┌──────────────────────────────────────────────────────────────┐
│  Farmhand daemon                                             │
│  Watches ~/.refarm/tasks/ → loads plugin → executes respond()│
└────────────────────┬─────────────────────────────────────────┘
                     │ WIT call: respond(payload: string)
                     ▼
┌──────────────────────────────────────────────────────────────┐
│  pi-agent WASM plugin                                        │
│  parse_respond_payload → provider::complete → tool loop      │
└────────┬───────────────────────────────────────┬─────────────┘
         │ LLM request (host-proxied)            │ tractor_bridge
         ▼                                       ▼
┌─────────────────┐                   ┌──────────────────────┐
│  LLM Provider   │                   │  Tractor (host)      │
│  (Anthropic,    │                   │  storeNode / CRDT    │
│   OpenAI-compat)│                   │  StreamRegistry      │
└─────────────────┘                   └──────────────────────┘
```

**Princípio-chave**: credenciais do LLM nunca saem do Tractor (ADR-053). O plugin WASM faz chamadas via WIT `complete-http-stream` — o host (Tractor) é quem faz o HTTP request real.

---

## 1. Modelos semânticos

### Effort / Task / Result

```
Effort (contexto + direção — o porquê)
  └── Task[] (chama pluginId.fn(args))
        └── TaskResult (ok/error + result/message)
```

```typescript
interface Task {
  id: string;
  pluginId: string;   // e.g. "pi-agent"
  fn: string;         // e.g. "respond"
  args?: unknown;     // JSON-serializable payload
}

interface EffortResult {
  effortId: string;
  status: "pending" | "in-progress" | "done" | "failed";
  results: TaskResult[];
  completedAt?: string;
}
```

### CRDT nodes que pi-agent persiste

| Node type | Quando | Campos relevantes |
|---|---|---|
| `UserPrompt` | antes do LLM call | `content`, `session_id`, `timestamp_ns` |
| `AgentResponse` | após cada delta (streaming) ou completo | `content`, `is_final`, `sequence`, `model`, `provider` |
| `UsageRecord` | após resposta final | `tokens_in`, `tokens_out`, `estimated_usd`, `provider` |
| `StreamChunk` | para cada delta de streaming | `stream_ref`, `content`, `sequence`, `is_final` |

---

## 2. Caminhos de transporte (coexistem)

Existem três caminhos para despachar tarefas ao Farmhand. Escolha com base no contexto:

### 2a. File transport (desenvolvimento local, CLI)

```bash
refarm task run pi-agent respond --args '{"prompt":"Olá"}'
```

- Escreve `~/.refarm/tasks/<effort-id>.json`
- Farmhand observa o diretório com `fs.watch`
- Resultado em `~/.refarm/task-results/<effort-id>.json`
- **Use quando**: desenvolvimento local, testes manuais, CLI

### 2b. HTTP sidecar (integração programática, porta 42001)

```bash
# Despachar
curl -X POST http://localhost:42001/efforts \
  -H "Content-Type: application/json" \
  -d '{"tasks": [{"id":"t1","pluginId":"pi-agent","fn":"respond","args":{"prompt":"Olá"}}]}'

# Consultar
curl http://localhost:42001/efforts/<effort-id>
```

- **Use quando**: integração de outras aplicações, testes automatizados com servidor ativo

### 2c. CRDT path (plugins internos, Tractor nativo)

```typescript
// Dentro de um plugin ou do próprio Tractor
tractor.storeNode({ "@type": "FarmhandTask", pluginId: "pi-agent", fn: "respond", args: {...} });
tractor.onNode("FarmhandTaskResult", (result) => { ... });
```

- **Use quando**: coordenação farmhand-to-farmhand, ADR-052 rendezvous

---

## 3. Fluxo completo: task dispatch

```
1. CLI / caller cria Effort com Task[]
2. FileTransportAdapter escreve ~/.refarm/tasks/<effort-id>.json
3. Farmhand detecta novo arquivo
4. Farmhand carrega plugin pi-agent de ~/.refarm/plugins/
5. Tractor invoca plugin.respond(payload: string)
6. Plugin: parse_respond_payload(payload) → { prompt, system }
7. Plugin verifica guards:
   - LLM_MAX_CONTEXT_TOKENS (limite de tokens)
   - LLM_BUDGET_<PROVIDER>_USD (cap de gasto 30 dias)
   - LLM_HISTORY_TURNS (janela de histórico conversacional)
8. Plugin chama provider::complete(messages[])
   → Se LLM_STREAM_RESPONSES=1: usa complete-http-stream WIT (host-proxied)
   → Senão: chamada síncrona única
9. Tool loop (se o LLM retornar tool_calls):
   - agent-fs: read_file, write_file, edit_file, list_dir, search_files
   - agent-shell: bash (com timeout 30s, argv obrigatório)
   - CRDT tools: list_sessions, current_session, navigate, fork
10. Plugin armazena via tractor_bridge.store_node():
    - UserPrompt node
    - AgentResponse node (is_final=true)
    - UsageRecord node
11. Farmhand constrói TaskResult, escreve resultado
```

---

## 4. Fluxo de streaming LLM → browser

Ativo apenas quando `LLM_STREAM_RESPONSES=1`:

```
1. Plugin chama WIT complete-http-stream (Tractor faz o HTTP)
2. Provider envia SSE chunks: data: {"delta":{"type":"text","text":"..."}}\n
3. Tractor lê cada frame SSE e persiste:
   - StreamChunk com sequence++ e is_final=false
   - AgentResponse parcial (projeção LLM, ADR-054)
4. No chunk final: StreamChunk com is_final=true
5. StreamRegistry.dispatch(chunk) → todos os transportes:
   ├─ FileStreamTransport → ~/.refarm/streams/<stream_ref>.ndjson
   ├─ SseStreamTransport  → GET http://localhost:42001/stream/<stream_ref>
   └─ WsStreamTransport   → WS ws://localhost:42001/ws/stream
6. Browser (BrowserSyncClient):
   - Conectado a ws://localhost:42000 (sync) ou :42001 (stream)
   - Recebe StreamChunks ordenados por sequence
   - Aplica ao LoroDoc local
   - Projector materializa em SQLite
   - UI renderiza tokens conforme chegam
```

**stream_ref** tem o formato `llm:<prompt_ref>` — usado para correlacionar chunks com a sessão de prompt.

---

## 5. Configuração de pi-agent

Variáveis de ambiente relevantes (definidas no host Tractor):

| Variável | Padrão | Descrição |
|---|---|---|
| `LLM_PROVIDER` | `anthropic` | `anthropic` ou `openai-compat` |
| `ANTHROPIC_API_KEY` | — | Credencial (fica no Tractor, nunca no plugin) |
| `LLM_MODEL` | `claude-sonnet-4-6` | Modelo a usar |
| `LLM_STREAM_RESPONSES` | `0` | `1` para streaming via SSE/WS |
| `LLM_MAX_CONTEXT_TOKENS` | — | Limite de tokens no contexto |
| `LLM_BUDGET_ANTHROPIC_USD` | — | Cap de gasto mensal (USD) |
| `LLM_HISTORY_TURNS` | `10` | Quantas turns do histórico incluir |
| `LLM_FALLBACK_PROVIDER` | — | Provider alternativo se principal falhar |

---

## 6. WIT contract do plugin (canônico)

O contrato WIT está em `packages/refarm-plugin-wit/`. A função de entry point:

```wit
world plugin {
  import tractor-bridge;   // store_node, query_nodes, log
  import agent-fs;         // read, write, edit (WASI-mapped)
  import agent-shell;      // spawn (policy-gated, timeout 30s)
  export respond: func(payload: string) -> result<string, plugin-error>;
}
```

Shape de resposta de `respond`:
```json
{
  "content": "...",
  "model": "claude-sonnet-4-6",
  "provider": "anthropic",
  "usage": {
    "tokens_in": 100,
    "tokens_out": 250,
    "estimated_usd": 0.0012
  }
}
```

---

## 7. Auto-boot de plugins

Farmhand carrega automaticamente plugins instalados em `~/.refarm/plugins/`. Para instalar:

```bash
refarm plugin install ./packages/pi-agent/dist/pi-agent.wasm
# ou via plugin courier (Nostr NIP-89 discovery):
refarm plugin install nostr:pi-agent
```

Estrutura esperada em `~/.refarm/plugins/`:
```
~/.refarm/plugins/
  pi-agent/
    plugin.wasm
    plugin.json    ← manifest (name, version, capabilities)
```

---

## Referências

- [ADR-052](../specs/ADRs/ADR-052-crdt-native-agent-rendezvous.md) — rendezvous CRDT entre agentes
- [ADR-053](../specs/ADRs/ADR-053-host-proxied-llm-streaming.md) — credenciais no host, streaming proxied
- [ADR-054](../specs/ADRs/ADR-054-generic-stream-observations.md) — StreamChunk como substrato genérico
- [ADR-055](../specs/ADRs/ADR-055-stream-contract-v1-transport-layer.md) — família de transportes
- [specs/features/farmhand-task-execution.md](../specs/features/farmhand-task-execution.md)
- [specs/features/pi-agent-effort-bridge.md](../specs/features/pi-agent-effort-bridge.md)
- [packages/pi-agent/README.md](../packages/pi-agent/README.md)
