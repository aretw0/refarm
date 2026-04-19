# HANDOFF — Refarm Pi Agent Sprint

> Documento de continuidade de sessão. Se você é Claude em uma nova conversa:
> leia este arquivo inteiro antes de escrever qualquer código.
> Se você é Arthur: cole este arquivo no início da próxima sessão.

**Data:** 2026-04-19 | **Branch:** `develop` | **Autor da sessão:** Arthur + Claude Sonnet 4.6

---

## Como retomar a sessão com Claude

Cole no início da conversa:

> "Estou retomando o sprint do Pi Agent do refarm. Leia o HANDOFF.md na raiz e me diga o que está pronto, o que está pendente, e o que precisamos fazer agora."

---

## Estado do pi-agent v0.1.0 — COMPLETO ✅

Tudo abaixo está commitado, testado e funcionando:

| Feature | Env vars | Status |
|---|---|---|
| Multi-provider LLM (Anthropic/OpenAI-compat/Ollama) | `LLM_PROVIDER`, `LLM_MODEL`, `LLM_BASE_URL` | ✅ |
| Soberania de provider (Ollama como último recurso) | `LLM_DEFAULT_PROVIDER` | ✅ |
| UsageRecord CRDT (tokens, custo, cache discount, `usage_raw`) | — | ✅ |
| Budget check rolling 30d por provider | `LLM_BUDGET_<PROVIDER>_USD` | ✅ |
| Context guard | `LLM_MAX_CONTEXT_TOKENS` | ✅ |
| Fallback automático | `LLM_FALLBACK_PROVIDER` | ✅ |
| Conversational memory (CRDT-backed) | `LLM_HISTORY_TURNS` | ✅ |
| Agentic tool loop (até N iters) | `LLM_TOOL_CALL_MAX_ITER` | ✅ |
| Tool: `read_file` / `write_file` | — | ✅ |
| Tool: `edit_file` (multi-edit mitsuhiko pattern) | — | ✅ |
| Tool: `list_dir` (bash ls) | — | ✅ |
| Tool: `search_files` (grep -rn, optional glob) | — | ✅ |
| Tool: `bash` (structured argv, no shell injection) | — | ✅ |
| Tool output squeez pipeline (ANSI strip → dedup → truncate) | `LLM_TOOL_OUTPUT_MAX_LINES` | ✅ |
| System prompt override | `LLM_SYSTEM` | ✅ |
| `.refarm/config.json` → env vars injetados no plugin | — | ✅ |
| Extensibility axioms A1–A4 (testes executáveis) | — | ✅ |

### Cobertura de testes atual

| Pacote | Testes nativos | O que garante |
|---|---|---|
| `pi-agent` | 54 | apply_edits, compress_tool_output, tools schema, providers, axioms A1-A4, usage math |
| `tractor` lib | 40 | ws_server routing, agent_tools_bridge, storage/sync/telemetry/trust, config.json injection |
| `tractor` harness | 7 (ignored, requerem WASM) | agent response, usage record, context guard, budget block, multi-turn, config.json, truncation |

Para rodar:
```bash
# Rápido e seguro (nunca vai OOM):
cargo test --lib -p pi-agent
cargo test --lib -p refarm-tractor

# Harness (requer build WASM primeiro):
cargo component build --release -p pi-agent
cargo test --test pi_agent_harness -p refarm-tractor -- --ignored --test-threads=1
```

---

## Estado v0.2.0 — Em progresso 🔄

### Feito neste sprint

- [x] `edit_file` — multi-edit mitsuhiko pattern (`{path, edits:[{old_str,new_str}]}`)
- [x] `list_dir` — `ls -1` via agent-shell
- [x] `search_files` — `grep -rn` via agent-shell, optional glob, exit 1 → mensagem amigável
- [x] `LLM_TOOL_OUTPUT_MAX_LINES` — squeez pipeline implementado + harness scenario
- [x] `LLM_SYSTEM` — system prompt injetável por distros
- [x] `.refarm/config.json` → env vars (`provider`, `model`, `default_provider`, `budgets`)
- [x] mdt documentation sync (`env_vars`, `tools`, `config_fields` blocks em README)
- [x] Harness expansion: tool use, fallback, multi-turn, config.json, truncation

### Pendente (prioridade: Segurança → CRDT → CLI)

#### 1. Segurança (inspirado em Gondolin — ver `packages/pi-agent/ROADMAP.md#security-roadmap`)

Os três itens a implementar, em ordem de impacto:

**A. `LLM_SHELL_ALLOWLIST`** — blocklist de comandos no `agent_shell::spawn`
- Onde: `packages/tractor/src/host/agent_tools_bridge.rs` — função que despacha argv
- Como: checar `argv[0]` contra lista antes de spawn; retornar `[blocked: <cmd> not in allowlist]`
- Env: `LLM_SHELL_ALLOWLIST=ls,grep,cat,git` (vazio = tudo bloqueado por default ou tudo permitido?)
- Decisão pendente: default permissivo (atual) ou default restritivo?

**B. `LLM_FS_ROOT`** — restrição de path no `agent_fs::read/write`
- Onde: `packages/tractor/src/host/agent_tools_bridge.rs` — funções fs read/write
- Como: normalizar path, checar prefixo antes de dispatch; rejeitar com `[blocked: path outside LLM_FS_ROOT]`
- Env: `LLM_FS_ROOT=/workspaces/myproject`

**C. Credential placeholder injection** (mais complexo, requer novo WIT)
- Hoje: plugin usa `wasi:http` e recebe `ANTHROPIC_API_KEY` via `inherit_env()`
- Alvo: tractor faz a chamada HTTP em nome do plugin; plugin recebe respostas, nunca a chave
- Requer: novo WIT `llm-bridge::complete(system, messages[])` em `packages/tractor/wit/host/`
- Plugin dropa `wasi:http` dependency completamente

#### 2. CRDT-backed RefarmConfig

- Onde: `packages/tractor/src/host/plugin_host.rs` — após `refarm_config_env_vars_from()`
- Como: `tractor_bridge::store_node("RefarmConfig", payload)` na carga do plugin
- Zero nova arquitetura — mesmos primitivos store/query já usados por UsageRecord
- Permite: auditar qual config estava ativa quando cada AgentResponse foi gerada

#### 3. CLI daily-driver (`tractor-native prompt` / `watch`)

- Onde: `packages/tractor/src/main.rs` — novo subcommand via `clap`
- `prompt`: conecta ao daemon na porta 42000, envia `user:prompt`, imprime `AgentResponse.content`
- `watch`: REPL loop — lê stdin linha a linha, imprime respostas; stateful via CRDT
- Se daemon não rodando: iniciar tractor efêmero no mesmo processo, responder, sair

---

## Commits recentes (este sprint)

```
0e3f182  test(tractor): harness scenario — LLM_TOOL_OUTPUT_MAX_LINES truncates tool result
5cb4d3f  test(tractor): harness scenario — .refarm/config.json injects LLM_PROVIDER
1b668dc  docs(terminal-plugin): renderers vs protocol — TUI, CLI, browser share same WS contract
6a64fa7  docs(terminal-plugin): ROADMAP — display/execution separation, REPL loop, agent transparency
16b496a  docs(roadmap): security section — lessons from Gondolin micro-VM sandbox
83aeb66  feat(pi-agent): LLM_SYSTEM env var — distro-injectable system prompt
f4036b5  docs(agents): build resource discipline — RAM constraints + safe cargo commands
a21ac1f  chore: .cargo/config.toml — limit build jobs + codegen-units for 8GB host
1ff4683  fix+refactor: apply_edits pure fn, ws_integration compile fix
4e6aa7c  feat(pi-agent): search_files tool — grep via agent-shell
a239bfc  feat(tractor): .refarm/config.json → LLM_* env vars for plugin sandbox
fdd8e9e  feat(pi-agent): list_dir tool — directory listing via bash ls
318e468  feat(pi-agent): edit_file — multi-edit pattern (mitsuhiko/agents-lab)
```

---

## Arquivos críticos para navegar

| Arquivo | O que é |
|---|---|
| `packages/pi-agent/src/lib.rs` | Pipeline completo: tools, providers, loop, compress, apply_edits |
| `packages/pi-agent/ROADMAP.md` | v0.2.0 checklist + security roadmap (Gondolin lessons) |
| `packages/tractor/src/host/plugin_host.rs` | `refarm_config_env_vars_from()` + WASI sandbox |
| `packages/tractor/src/host/agent_tools_bridge.rs` | Onde implementar LLM_SHELL_ALLOWLIST e LLM_FS_ROOT |
| `packages/tractor/tests/pi_agent_harness.rs` | 7 cenários de integração real (WASM + mock LLM) |
| `packages/terminal-plugin/ROADMAP.md` | Display layer: v0.2.0 WS + ShellOutput CRDT |
| `.cargo/config.toml` | jobs=4, codegen-units=4 — proteção contra OOM no host 8GB |
| `AGENTS.md` — seção 7 | Regras de RAM: comandos cargo ordenados por custo de memória |

---

## Decisões arquiteturais (não reverter sem discussão)

1. **Source is Truth** — nunca editar `dist/`, `build/`, `.turbo/`
2. **`apply_edits` é pura** — extraída para nível de módulo, testável nativamente; dispatch WASM delega a ela
3. **`tools_anthropic/openai` fora de `#[cfg(wasm32)]`** — mesma razão: testabilidade nativa
4. **multi-edit pattern (mitsuhiko)** — `{old_str, new_str}` exact-match, rejeita ambiguidade (>1 match)
5. **`refarm_config_env_vars_from(base: &Path)`** — recebe diretório como parâmetro (não lê `current_dir()` internamente) para testabilidade sem race conditions
6. **`cargo test --lib` sempre** — nunca `cargo test` bare (OOM em 8GB com 16 codegen-units paralelas)
7. **`agent-tools.wasm` ≠ `terminal-plugin`** — execução (Rust/WASM/OS) e display (TS/DOM/browser) nunca colapsam em um pacote
8. **Segurança antes de CLI** — LLM_SHELL_ALLOWLIST/LLM_FS_ROOT protegem o sistema antes de abrir interface de linha de comando

---

## agents-lab (aretw0/agents-lab) — análise concluída

O repo é curadoria de **Pi skills (markdown comportamental)**, não tool schemas executáveis.
Tudo que os git-skills descrevem já é coberto pelo `bash` tool do pi-agent.
Alinhamento acontece no nível de **distro** — uma versão "coding farmhand" injeta os skills via `LLM_SYSTEM`.
Nenhum novo core tool emerge da análise.

Único padrão com potencial futuro: `git-checkout-cache` (cache de repos remotos em `~/.cache/checkouts/<host>/<org>/<repo>`) — candidato a tool `clone_repo` num sprint futuro.

---

> "Cultivamos o código como cultivamos o solo: com paciência, honestidade e respeito pelo ciclo."
