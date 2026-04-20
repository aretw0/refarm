# HANDOFF — Refarm Pi Agent Sprint

> Documento de continuidade de sessão. Se você é Claude em uma nova conversa:
> leia este arquivo inteiro antes de escrever qualquer código.
> Se você é Arthur: cole este arquivo no início da próxima sessão.

**Data:** 2026-04-19 | **Branch:** `develop` | **Autor da sessão:** Arthur + Claude Sonnet 4.6

---

## Atualização desta sessão (prioridade CI + higiene de swarm)

### Checkpoint de contexto (janela alta)

- Entramos em modo de contenção de contexto: sem novas frentes longas até compact.
- `c1` (CLI `prompt/watch`) e `c2` (diagnóstico CI) concluíram com relatório.
- Nenhuma worktree de colônia permaneceu após `COMPLETE` (sem caminho para cherry-pick direto); promover apenas com evidência no repo atual.
- Evidência objetiva de CI (run `24638176936`, job `quality`): falha em `@refarm.dev/tractor-rs#lint` por clippy `-D warnings`.
  - `plugin_host.rs`: dead_code em `AgentToolsHandle` (`component`, `store`)
  - `agent_tools_bridge.rs`: `unnecessary_cast` e `needless_borrows_for_generic_args`
- Backups locais de segurança estão em `/tmp/refarm-safety/` (patch/index/untracked snapshot).
- Próximo passo após compact: aplicar/podar fixes mínimos de lint + validar `tractor-rs#lint` local e então integrar.

### Checkpoint pós-contenção (modo manual, sem colônias)

- Estratégia ativa: seguir em execução **serial, auditável e verificável** no branch atual (sem depender de worktree efêmera de colônia).
- Fix mínimo de CI/lint aplicado: `packages/tractor/src/host/plugin_host.rs`
  - `#[allow(dead_code)]` em `AgentToolsHandle.component` e `AgentToolsHandle.store`.
- CLI piloto `prompt/watch` reimplementado manualmente em `packages/tractor/src/main.rs`:
  - `tractor prompt` envia `user:prompt` via WS (`type/agent/payload`) e pode aguardar resposta final.
  - `tractor watch` observa `AgentResponse` por polling de storage (fallback resiliente).
- Documentação atualizada: `packages/tractor/README.md` (uso de `prompt/watch`).
- Commits atômicos já criados neste bloco:
  - `f076ced` — `fix(tractor-host): silence dead_code on agent tools handle`
  - `1dd15eb` — `feat(tractor-cli): add prompt/watch commands with storage fallback`
  - `87b7cc5` — `feat(security): enforce host llm bridge and sandbox guards`
  - `9541319` — `docs(factory-loop): add no-colony fallback and session checkpoints`
  - `9d9b3a5` — `fix(devcontainer): harden git auth and speed pre-push checks`
  - `3db1ef2` — `fix(hooks): skip lint for non-workspace changes on push`
- Push para `origin/develop` concluído com sucesso após ajustes de auth/hook.
- Validação frugal executada:
  - `cd packages/tractor && cargo check --all-targets` ✅
  - `cd packages/tractor && cargo test --lib` ✅ (56 testes)
  - `cd packages/tractor && cargo check --bin tractor` ✅
  - `cd packages/tractor && cargo test --bins` ✅
  - `cd packages/tractor && cargo run --bin tractor -- --help` ✅
  - `cd packages/tractor && cargo run --bin tractor -- prompt --help` ✅
  - `cd packages/tractor && cargo run --bin tractor -- watch --help` ✅
  - Smoke E2E local (daemon + `prompt` + `watch`) em `--port 42111` ✅
- Limitação conhecida do ambiente:
  - `cargo clippy` indisponível localmente (`cargo-clippy` não instalado; tentativa de `rustup component add clippy` falhou).
- Backup anti-perda atualizado:
  - patch: `/tmp/refarm-safety/wip-no-colony-20260420-014610.patch`
  - status: `/tmp/refarm-safety/wip-no-colony-20260420-014610.status.txt`

### Status objetivo (agora)

- `npm audit --audit-level=high` → **0 vulnerabilities**
- `npm audit --audit-level=high --omit=dev` → **0 vulnerabilities**
- `npm audit --json` (metadata) → `high: 0`, `critical: 0`, `total: 0`
- `git status --porcelain` → **limpo**
- `git status -sb` → `develop...origin/develop` (sem diferenças locais/remotas)
- CI pós-push (`run 24646812942`) → **success**
  - `audit-moderate` ✅
  - `quality` ✅
  - `build` ✅
  - `e2e` ✅
  - `summary` ✅

### Segurança do Tractor implementada nesta retomada

Arquivos alterados:
- `packages/tractor/src/host/agent_tools_bridge.rs`
- `packages/tractor/src/host/wasi_bridge.rs`
- `packages/tractor/src/host/plugin_host.rs`
- `packages/tractor/wit/host/refarm-plugin-host.wit`
- `packages/pi-agent/wit/world.wit`
- `packages/pi-agent/src/lib.rs`
- `packages/pi-agent/README.md`
- `packages/pi-agent/ROADMAP.md`

Implementações:
- `LLM_SHELL_ALLOWLIST` no host (`spawn_process`) com erro explícito: `[blocked: <cmd> not in allowlist]`
- `LLM_FS_ROOT` no host (`agent_fs::read/write/edit`) com bloqueio fora de raiz
- `llm-bridge::complete-http(...)` no WIT host e implementação nativa no Tractor
- `pi-agent` deixou de usar `wasi:http` para provider calls; agora usa `llm-bridge` (chave fica no host)
- plugin WASI env não herda mais tudo (`inherit_env` removido): só `LLM_*` + overrides de `.refarm/config.json`
- hardening inicial do `llm-bridge`: valida rota esperada por env (`provider/base_url/path`) e remove headers sensíveis injetados pelo plugin (`authorization`, `x-api-key`)

Validação executada (modo frugal):
- `cd packages/tractor && cargo check --lib` ✅
- `cd packages/pi-agent && cargo check --lib` ✅
- `cd packages/pi-agent && cargo check --target wasm32-wasip1` ✅

### O que já foi corrigido para estabilizar CI/audit

Commit local de referência: **`a1d59c6`**

Arquivos-chave desse ajuste:
- `package.json`
- `package-lock.json`
- `packages/heartwood/package.json`
- `docs/DEVOPS.md`

Remediações aplicadas:
- override `basic-ftp` para `5.3.0`
- override em `yaml-language-server` para usar `yaml 2.8.3`
- `heartwood`: trocar `npx jco transpile` por `jco transpile`
- root: reforço de tipos Node para builds TS

### Nota sobre `npm ci` desta sessão

Houve execução em background encerrada com `SIGTERM` (process terminated).
Isso **não** foi falha de dependência/audit; foi interrupção do processo de execução.

### Higiene para não conflitar com a colônia

- Não parar a colônia ativa (`c1`) só por existir trabalho local.
- Stash de proteção já existe: `stash@{0}` (`wip(local): monitor yaml noise before colony consolidation`)
- Backup patch local: `/tmp/refarm-wip-before-colony-20260419-172840.patch`
- Consolidar somente em janela limpa:
  1. colônia sair de `launched`
  2. existir evidência objetiva de arquivos alterados + validações
  3. workspace continuar limpo antes de merge/cherry-pick

### Pendências imediatas para próxima sessão

1. Se houver nova regressão de lint/type-check, aplicar fix mínimo e preservar abordagem de commits atômicos.
2. Continuar roadmap do `tractor`/`pi-agent` em modo auditável (sem dependência de worktrees efêmeras de colônia).
3. Reavaliar retomada de colônias apenas após correção de retenção/promoção no pi-stack.
4. Higiene futura de CI: expandir migração Node20 → Node24 para workflows restantes (em `test.yml` já há opt-in via `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`).

### Modo operacional pedido pelo usuário

- Respostas curtas, checkpoints objetivos.
- Evitar varreduras longas de JSONL sem necessidade.
- Manter contexto enxuto para não explodir janela de tokens.
- Operar em modo frugal de recursos: provar hipótese com `cargo check`/teste pontual, nunca build global sem necessidade.

### Guardrails de contexto e storage (anti-inchaço)

- Quando a sessão ficar longa (muitos diffs + múltiplas frentes), consolidar no `HANDOFF.md` antes de abrir nova frente.
- Preferir ciclos curtos: **1 mudança → 1 validação mínima → 1 checkpoint**.
- Evitar comandos pesados de varredura repetitiva (`du`/`find` amplos) sem objetivo direto.
- Se disco ficar crítico novamente: limpar apenas artefatos gerados do pacote alvo (`target/`, `.turbo`, outputs de teste), nunca `src/`.

### Calibração de ferramentas (estado observado)

- `cargo-component` ✅ instalado
- `rustfmt` ❌ ausente (`rustup component add rustfmt`)
- `ast-grep` ❌ ausente (instalar via pacote/binário para buscas semânticas)

---

## Como retomar a sessão com Claude

Cole no início da conversa:

> "Estou retomando o sprint do Pi Agent do refarm. Leia o HANDOFF.md na raiz e me diga o que está pronto, o que está pendente, e o que precisamos fazer agora."

---

## Estado do pi-agent — Fundação implementada

> Não existe v0.1.0 publicado — versões no ROADMAP são marcadores organizacionais, não releases.
> O Refarm só "chega" quando for o daily driver do Arthur. O que está abaixo é base construída,
> não produto entregue.

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
| Shell allowlist guard (host-side) | `LLM_SHELL_ALLOWLIST` | ✅ |
| FS root guard (host-side read/write/edit) | `LLM_FS_ROOT` | ✅ |
| System prompt override | `LLM_SYSTEM` | ✅ |
| `.refarm/config.json` → env vars injetados no plugin | — | ✅ |
| Extensibility axioms A1–A4 (testes executáveis) | — | ✅ |

### Cobertura de testes atual

| Pacote | Testes nativos | O que garante |
|---|---|---|
| `pi-agent` | 54 | apply_edits, compress_tool_output, tools schema, providers, axioms A1-A4, usage math |
| `tractor` lib | 56 | ws_server routing, agent_tools_bridge (incl. shell/fs/trusted_plugins), llm-bridge route guard, RefarmConfig audit node, storage/sync/telemetry/trust, config.json injection |
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

## O que foi construído neste sprint

- [x] `edit_file` — multi-edit mitsuhiko pattern (`{path, edits:[{old_str,new_str}]}`)
- [x] `list_dir` — `ls -1` via agent-shell
- [x] `search_files` — `grep -rn` via agent-shell, optional glob, exit 1 → mensagem amigável
- [x] `LLM_TOOL_OUTPUT_MAX_LINES` — squeez pipeline implementado + harness scenario
- [x] `LLM_SYSTEM` — system prompt injetável por distros
- [x] `.refarm/config.json` → env vars (`provider`, `model`, `default_provider`, `budgets`)
- [x] mdt documentation sync (`env_vars`, `tools`, `config_fields` blocks em README)
- [x] Harness expansion: tool use, fallback, multi-turn, config.json, truncation

## Próximos passos (prioridade: Segurança → CRDT → CLI)

#### 1. Segurança (inspirado em Gondolin — ver `packages/pi-agent/ROADMAP.md#security-roadmap`)

Itens de segurança já implementados nesta retomada:

**A. `LLM_SHELL_ALLOWLIST`** — guard de comandos no `agent_shell::spawn` ✅
- `argv[0]` validado antes de spawn
- Bloqueio explícito: `[blocked: <cmd> not in allowlist]`
- Semântica: unset = permissivo; vazio = bloqueia tudo

**B. `LLM_FS_ROOT`** — restrição de path em `agent_fs::{read,write,edit}` ✅
- Prefix check após resolução de caminho
- Bloqueio explícito: `[blocked: path outside LLM_FS_ROOT]`

**C. Credential placeholder injection (phase 1)** ✅
- Novo WIT host `llm-bridge::complete-http(provider, base_url, path, headers, body)`
- `pi-agent` removeu provider calls via `wasi:http`; usa `llm-bridge`
- Chaves (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`) ficam no host

**D. `trusted_plugins`** — capability gate para `agent-shell` ✅
- Campo `.refarm/config.json.trusted_plugins[]`
- Bloqueio explícito por `plugin_id` não autorizado
- Suporte a wildcard `"*"`

#### 2. CRDT-backed RefarmConfig ✅

- Implementado em `packages/tractor/src/host/plugin_host.rs`
- No `load()` do plugin, tractor persiste nó `RefarmConfig` no sync (`sourcePlugin: tractor-host`)
- Payload inclui: `plugin_id`, `workspace`, `config_path`, `llm_env` efetivo e `config_json`
- Permite auditar qual config/env estava ativa quando cada sessão do agent foi inicializada

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
