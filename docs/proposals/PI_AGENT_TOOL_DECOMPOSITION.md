# Pi Agent Tool Decomposition — Requisitos e Plano

**Date**: 2026-04-17
**Status**: Rascunho Ativo
**ADR**: [ADR-050](../../specs/ADRs/ADR-050-zig-wasm-agent-tool-host.md)
**Contexto**: [VISION_2026_AI_AGENT_SOVEREIGNTY.md](./VISION_2026_AI_AGENT_SOVEREIGNTY.md)

---

## O que é o Pi Agent neste contexto

Pi é o agente coding mínimo — terminal-first, zero overhead de UI. Expõe exatamente 4 ferramentas atômicas ao LLM:

| Tool | Semântica |
|------|-----------|
| `read` | Lê conteúdo de um path (file ou recurso) |
| `write` | Escreve/sobrescreve conteúdo em um path |
| `edit` | Aplica um diff preciso a um arquivo existente |
| `bash` | Executa um comando e retorna stdout/stderr |

Toda outra capacidade do agente é composta dessas 4 primitivas.

---

## Estado Atual do Refarm — O Que Já Existe

O refarm **já possui a infra-estrutura correta**; o agente Pi é o cliente que a usa:

```
refarm-sdk.wit           → WIT estável (WASI Preview 2, Component Model)
packages/tractor         → Host Rust/wasmtime graduado (ADR-048, 27 MB)
packages/tractor-ts      → Host TypeScript (browser/Node.js)
packages/plugin-tem      → Cognitive map / TEM — blueprint do agente
packages/barn            → Ciclo de vida de plugins (SDD em progresso)
packages/windmill        → Automação/Workflows
wit/refarm-sdk.wit       → tractor-bridge (store/get/query/permission/telemetry)
```

### O que FALTA para o Pi Agent funcionar

1. **`agent-tool-contract-v1.wit`** — WIT com as 4 ferramentas
2. **Plugin `pi-agent.wasm`** — implementa `world refarm-plugin`, importa o contrato de ferramentas
3. **Host capability para `bash`** — tractor expõe spawn sandboxado via argv (sem interpolação de shell)
4. **TEM como orquestrador** — recebe contexto do agente e decide qual ferramenta acionar

---

## Mapa Host vs. Guest para as 4 Ferramentas

```
Host (tractor — Rust/wasmtime)        Guest (pi-agent.wasm)
──────────────────────────────────     ──────────────────────────────────
wasi:filesystem resolve e abre fd      read: lê bytes, interpreta encoding
wasi:filesystem escreve atomicamente   write: gera conteúdo final
wasi:filesystem + wasi:io streams      edit: gera diff myers, aplica via host
spawn(argv[]) sandboxado, timeout      bash: constrói argv, parseia saída
tractor-bridge: store/get nodes        qualquer tool: persiste resultado no grafo
```

**Regra invariante**: o host nunca interpreta conteúdo. O guest nunca acessa o filesystem diretamente.

---

## Requisitos de Sistema

### RS-01 — Sandboxing de `bash`
- Host aceita apenas `argv[]` estruturado — sem interpolação de shell
- Timeout obrigatório (padrão: 30s, configurável no TrustGrant do plugin)
- Stdout/stderr capturados em buffer; sem herança de fd do processo host
- Allowlist de binários declarada no manifest do plugin

### RS-02 — `edit` atômico
- Host aplica diff recebido do guest em operação atômica (write tmp → fsync → rename)
- Se patch falhar (contexto não bate), retorna erro — guest decide retry

### RS-03 — Capability-gating
- Plugin Pi declara no manifest: `read-fs`, `write-fs`, `spawn-shell`
- TrustManager (já em `packages/tractor`) verifica antes de qualquer tool call
- Usuário vê prompt de permissão na primeira execução (via `request-permission` do `tractor-bridge`)

### RS-04 — Persistência no Grafo Soberano
- Cada ação do agente pode gerar um `json-ld-node` via `store-node`
- O agente mantém histórico de ações como grafo auditável, não apenas logs

### RS-05 — Composição com TEM
- `plugin-tem` recebe intenção do usuário → decide sequência de ferramentas
- TEM usa `query-nodes` para contexto antes de acionar `read`/`edit`

---

## Plano de Decomposição (Fases)

### Fase 1 — Contrato WIT das 4 Ferramentas (Curto Prazo)
- [ ] Criar `wit/agent-tool-contract-v1.wit` com interfaces `agent-fs` e `agent-shell`
- [ ] Estender `world refarm-plugin` com `import agent-tool-contract`
- [ ] Adicionar spawn sandboxado ao host Rust (tractor) como capability controlada pelo TrustManager

### Fase 2 — Plugin Pi Mínimo em Rust (Curto Prazo)
- [ ] `packages/pi-agent/` — cargo-component implementando as 4 ferramentas
- [ ] Testes de conformidade: tool calls com/sem permissão, timeout de bash, edit com patch inválido
- [ ] Integração com TEM: recebe prompt → sequência de tool calls

### Fase 3 — ClojureWasm como Guest Logic (Médio Prazo)
- [ ] Avaliar zwasm/babashka-wasm para WasmGC
- [ ] Shim JSON-over-streams se WasmGC não disponível ainda
- [ ] Migrar lógica de diff/parsing do Rust para ClojureWasm iterativamente

### Fase 4 — Host Zig Pi-Nano (Longo Prazo — Condicional)
- [ ] Apenas se dispositivo-alvo não suportar wasmtime (~27 MB)
- [ ] Footprint alvo ≤5 MB com interpretador WASM mínimo
- [ ] Mesmo schema `PHYSICAL_SCHEMA_V1`; mesmo protocolo WS binário (porta 42000)

---

## Próximas 3 Tarefas Imediatas (Backlog)

| # | Tarefa | Prioridade | Bloqueador |
|---|--------|------------|------------|
| 1 | Criar `wit/agent-tool-contract-v1.wit` com as 4 interfaces Pi | Alta | — |
| 2 | Adicionar capability de spawn sandboxado ao `packages/tractor` (Rust host) | Alta | Tarefa 1 |
| 3 | Avaliar maturidade do zwasm/babashka-wasm para WasmGC — registrar go/no-go | Média | — |

---

## Decisões Tomadas

| Decisão | Razão |
|---------|-------|
| Manter host Rust/wasmtime como primário | ADR-048 graduado; trocar para Zig agora = risco sem benefício imediato |
| Host Zig = "Pi-Nano" condicional | Apenas para dispositivos <4 MB onde wasmtime não cabe |
| ClojureWasm via shim JSON enquanto zwasm imaturo | Não bloquear Fase 1/2 por imaturidade de WasmGC |
| `bash` como argv[] sandboxado, sem interpolação de shell | Segurança: interpolação é vetor de injeção |
| Plugin Pi persiste ações no Grafo Soberano | Auditabilidade nativa; reutiliza tractor-bridge existente |
