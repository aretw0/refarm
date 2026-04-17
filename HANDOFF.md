# HANDOFF — Refarm Pi Agent Sprint

> Documento de continuidade de sessão. Se você é Claude em uma nova conversa:
> leia este arquivo inteiro antes de escrever qualquer código.
> Se você é Arthur: cole este arquivo no início da próxima sessão.

**Data:** 2026-04-17 | **Branch:** `develop` | **Autor da sessão:** Arthur + Claude Sonnet 4.6

---

## O que foi construído nesta sessão

### Commits entregues (em ordem)

```
1e6181c  docs: Pi Agent decomposition, ADR-050, and agentic inspirations
eaf3017  feat(tractor): add agent-tool WIT interfaces and host bridge for Pi Agent
190afb5  chore(devcontainer): harden Rust build against 4 GB memory cap
```

### Artefatos criados

| Arquivo | O que é |
|---------|---------|
| `specs/ADRs/ADR-050-zig-wasm-agent-tool-host.md` | Decisão arquitetural: Zig/zwasm host (Pi-Nano) + análise host vs. guest |
| `docs/proposals/PI_AGENT_TOOL_DECOMPOSITION.md` | Requisitos e plano de fases para as 4 ferramentas do Pi Agent |
| `wit/agent-tool-contract-v1.wit` | WIT das 4 ferramentas: `agent-fs` (read/write/edit) + `agent-shell` (spawn) |
| `packages/tractor/wit/host/refarm-plugin-host.wit` | Atualizado com `agent-fs` e `agent-shell` como imports do world |
| `packages/tractor/src/host/agent_tools_bridge.rs` | Implementação Rust das 4 ferramentas + 10 testes unitários |
| `packages/tractor/src/host/mod.rs` | +`mod agent_tools_bridge` |
| `packages/tractor/Cargo.toml` | +`diffy`, +`tempfile`, +`codegen-units=1` no profile dev |
| `.devcontainer/devcontainer.json` | +`CARGO_BUILD_JOBS=2` para proteger o container de 4 GB |
| `docs/INSPIRATIONS.md` | Nova seção "Agente Soberano": Claude Code, Zig, Babashka, zwasm, nullclaw |

---

## Decisões arquiteturais tomadas (NÃO reverter sem discussão)

### 1. Pi-Nano: Zig + zwasm (Caminho B confirmado)

O próximo host WASM do refarm é escrito em **Zig** usando **zwasm** como runtime do Component Model.

- **zwasm** (https://github.com/clojurewasm/zwasm): runtime WASM em Zig, v1.7.0, ~1.2 MB, 100% Component Model spec (62k testes). Produção-ready.
- **nullclaw** (https://github.com/nullclaw/nullclaw): framework de AI assistant em Zig, 678 KB, <2ms boot. Referência de design para o CLI agêntico.
- O host Rust/wasmtime (`packages/tractor`) **não é substituído** — é o daemon primário. O host Zig é o Pi-Nano para edge/constrained.
- Plugins `.wasm` compilados para Component Model rodam nos dois hosts sem recompilação.

### 2. Agent tools: plugin, não primitiva do host

**A implementação atual em `agent_tools_bridge.rs` está correta como Fase 1 (bridge de desenvolvimento), mas a arquitetura alvo é:**

```
tractor host (árbitro de composição)
├── carrega agent-tools.wasm  ← EXPORTA: agent-fs, agent-shell
├── carrega pi-agent.wasm     ← IMPORTA: agent-fs, agent-shell
└── conecta em tempo de carga via Component Model composition
```

Motivação: usuário soberano pode substituir `agent-tools.wasm` por implementação própria sem recompilar o agente. Mesmo padrão do Pi (MCP servers = tool plugins).

**O WIT está correto** (`wit/agent-tool-contract-v1.wit`). Só quem implementa muda (host → plugin).

### 3. Ferramentas de build — regras de sobrevivência do devcontainer

O container tem **4 GB hard cap** (`--memory=4g`). Cranelift usa ~1.5 GB/job.

```bash
# ✅ SEMPRE usar:
cargo check                        # valida sem codegen (~300 MB)
cargo test --test <arquivo>        # um arquivo de teste por vez

# ❌ NUNCA usar sem aviso explícito ao Arthur:
cargo build                        # codegen completo → OOM risco
cargo test                         # suite completo → OOM risco
```

`CARGO_BUILD_JOBS=2` está em `devcontainer.json` — entra em vigor no próximo **Rebuild Container**.

---

## Próximo sprint: o que fazer

### Tarefa 2A — `packages/agent-tools/` (plugin que exporta as 4 ferramentas)

Mover a lógica de `packages/tractor/src/host/agent_tools_bridge.rs` para um plugin cargo-component standalone.

```
packages/agent-tools/
├── Cargo.toml          (cargo-component, wasm32-wasip2 target)
├── wit/
│   └── world.wit       (importa wasi:filesystem, wasi:cli; exporta agent-fs + agent-shell)
└── src/
    └── lib.rs          (implementação — mesma lógica do agent_tools_bridge.rs atual)
```

O WIT de exportação já existe em `wit/agent-tool-contract-v1.wit`. Adaptar para world de plugin.

### Tarefa 2B — Tractor aprende a compor plugins

Quando carregar um plugin que importa `agent-fs`, o tractor deve:
1. Verificar se há um plugin carregado que exporta `agent-fs`
2. Fazer a fiação via `Linker` (wasmtime já suporta isso)
3. Fallback para host primitive se não houver plugin de ferramentas

O `get-plugin-api` em `tractor-bridge` (WIT) é o embrião desta descoberta.

### Tarefa 2C — `packages/pi-agent/` (o agente em si)

Plugin cargo-component que:
- Importa `agent-fs`, `agent-shell` (do world de composição)
- Importa `tractor-bridge` (acesso ao grafo soberano)
- Exporta `integration` (lifecycle do tractor: setup/ingest/on-event)
- Recebe prompts via `on-event("user:prompt", payload)` e responde via tool calls

### Tarefa 3 — Pi-Nano host em Zig (sprint seguinte)

Scaffold de `packages/tractor-zig/` usando zwasm:
- Não é substituto do Rust tractor — é o segundo runtime do ADR-049
- Implementa o mesmo protocolo WebSocket (porta 42000, frames Loro binários)
- Mesmo `PHYSICAL_SCHEMA_V1` SQLite
- Muito mais leve para desenvolver (sem cranelift)

---

## Referências críticas

| Recurso | URL / Path | Por quê importa |
|---------|-----------|-----------------|
| zwasm | https://github.com/clojurewasm/zwasm | Runtime WASM em Zig para Pi-Nano |
| nullclaw | https://github.com/nullclaw/nullclaw | Design do CLI agêntico em Zig |
| ADR-050 | `specs/ADRs/ADR-050-zig-wasm-agent-tool-host.md` | Decisões Zig/zwasm + decomposição Pi tools |
| PI decomposition | `docs/proposals/PI_AGENT_TOOL_DECOMPOSITION.md` | Requisitos e fases |
| WIT contrato | `wit/agent-tool-contract-v1.wit` | Interfaces das 4 ferramentas |
| Host WIT | `packages/tractor/wit/host/refarm-plugin-host.wit` | World que o host Rust/Zig implementa |
| Agent tools bridge | `packages/tractor/src/host/agent_tools_bridge.rs` | Fase 1 (host primitive, migrar para plugin) |
| ADR-047/048/049 | `specs/ADRs/` | Contexto do Rust tractor graduado |
| VISION 2026 | `docs/proposals/VISION_2026_AI_AGENT_SOVEREIGNTY.md` | Estrela do norte: AI como WASI syscall |

---

## Perguntas abertas (Arthur decide)

1. **Sequência das tarefas 2A/2B/2C**: fazer em paralelo ou sequencial? Sugestão: 2A → 2B → 2C.
2. **CLI agêntico**: aproveitar Anthropic SDK (Claude API) como LLM backend? Ou agnóstico de provider desde o início? nullclaw é agnóstico — pode ser o modelo.
3. **Devcontainer rebuild**: quando fazer? O `CARGO_BUILD_JOBS=2` só entra em vigor após rebuild. Pode fazer no início do próximo sprint.

---

## Estado do repositório ao fechar a sessão

```bash
git log --oneline -5
# 190afb5 chore(devcontainer): harden Rust build against 4 GB memory cap
# eaf3017 feat(tractor): add agent-tool WIT interfaces and host bridge for Pi Agent
# 1e6181c docs: Pi Agent decomposition, ADR-050, and agentic inspirations
# 853be7c chore(devcontainer): adicionar suporte a configurações de localidade e cache
# a679389 chore(factory): harden devcontainer and swarm preflight

git status
# nothing to commit, working tree clean
```

`cargo check` em `packages/tractor` — zero erros, zero warnings.

---

## Como retomar a sessão com Claude

Cole no início da conversa:

> "Estou retomando o sprint do Pi Agent do refarm. Leia o HANDOFF.md na raiz do projeto e me diga o que está pronto, o que está pendente, e o que precisamos fazer agora."

---

> "Cultivamos o código como cultivamos o solo: com paciência, honestidade e respeito pelo ciclo."
