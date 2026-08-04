# Writeup captures — prints + records for the work (finalized in job-vault-bk)

A concrete shot-list: what to run, what to capture (a terminal print, a browser shot, or a saved file),
and the one-line claim each capture proves. Grouped by the story it tells. Commands assume the example's
CLI is built (`pnpm --filter <example> build`); swap `<cli>` for `dgk` (or a white-labeled `DGK_COMMAND`).

> Convention: **PRINT** = terminal screenshot · **SHOT** = browser screenshot · **FILE** = keep the
> emitted artifact (path noted). Prefer a real TTY for terminal shots so color + borders render.

## Automação rápida

Para gerar um pacote regenerável de prints + registros para o agente escritor:

```bash
pnpm run writeup:captures
# ou, sem depender do wrapper pnpm:
node scripts/capture-writeup-assets.mjs
```

Saída padrão: `.dgk/writeup-captures/<timestamp>/` (ignorado pelo git), com:

- `png/` — screenshots prontos para colar no vault ou documento;
- `html/` — fonte reprodutível de cada screenshot;
- `svg/` e `diagrams/` — grafos/diagramas vetoriais;
- `records/` — `T1-report.md`, `T2-report.md`, `T3-report.md` e SVGs de relatório;
- `INDEX.md` — tabela com legenda curta, claim sustentado e comando de origem.

Opções úteis:

```bash
node scripts/capture-writeup-assets.mjs --out "$HOME/git/vault/20 - Projects/Prêmio Serpro de Inovação/refarm-captures"
node scripts/capture-writeup-assets.mjs --only t3
node scripts/capture-writeup-assets.mjs --no-screenshots   # gera HTML/SVG/records sem Chrome
```

O script usa os CLIs já compilados em `examples/*/dist/cli.js` e `google-chrome` em modo headless
para transformar os fragments HTML/SVG dos exemplos em PNG. Se um CLI ainda não existir, rode o build
escopado do exemplo ou use `--build`.

Para registrar uma execução real do plugin `@refarm/agent` no runtime Rust:

```bash
refarm sow   # se a rota/credencial do modelo estiver expirada
CARGO_TARGET_DIR="$PWD/.cache/cargo-target" pnpm run writeup:agent-record
```

Saída padrão: `.dgk/agent-live-record/<timestamp>/`, com `ask-live.json`, estado do runtime/plugin,
`session-live.json`, `task-result-live.json`, `scarecrow-audit.ndjson`, `tractor.log` e um `INDEX.md`
com a legenda curta. O script importa a rota de modelo recém-semeada via `refarm model env` sem gravar
valores secretos no pacote de evidência.

### Registro COM chamada de ferramenta (agente + lsp-code-ops)

O registro acima prova governança e observabilidade, mas sai com `tool_calls: 0`: o prompt padrão é
uma pergunta, e o agente sozinho não tem ferramenta para chamar. Para uma trilha que exercite
`code-ops`, três coisas precisam estar no lugar — e nenhuma é automática.

**1. O plugin de ferramenta precisa ser instalado E autorizado.** Estar compilado não basta; o
runtime recusa carregar o que não foi declarado confiável. O ciclo completo, que é ele próprio a
evidência de governança:

```bash
export CARGO_TARGET_DIR="$PWD/.cache/cargo-target" REFARM_HOME="$PWD/.refarm"
refarm plugin review packages/lsp-code-ops/dist          # valida o manifesto, instala nada
refarm plugin install packages/lsp-code-ops/dist/plugin.json   # carimba integridade SHA-256
refarm plugin permissions @refarm/lsp-code-ops           # o que ele pede, e com que risco
refarm plugin trust lsp-code-ops --scope workspace       # eixo IDENTIDADE: pode carregar
refarm plugin trust agent --scope workspace              # a lista É a lista: sem isto o agente sai
refarm plugin approve @refarm/lsp-code-ops --approve fs:read --approve fs:write --scope workspace
refarm runtime restart --wait
```

O `approve` acima concede as duas permissões de menor risco e deixa `shell:spawn` de fora — a trilha
depois mostra `host-effect:fs:read` e nenhum efeito da recusada. **Confiar apenas no plugin novo
derruba o agente**: a lista de confiança substitui, não acrescenta.

**2. Um servidor de linguagem precisa existir e ser apontado.** O host gerencia o subprocesso e o
default é `rust-analyzer`; apontá-lo a um arquivo `.ts` devolve resultado sem sentido, não um erro.

```bash
pnpm add -g typescript-language-server typescript
# o daemon lê .refarm/.env — o valor tem espaço, então precisa de aspas:
echo 'REFACTOR_LSP_CMD="'"$HOME"'/.local/share/pnpm/bin/typescript-language-server --stdio"' > .refarm/.env
```

Quando houver divergencia entre configuracao e runtime, confirme o contexto efetivo antes de prosseguir:

```bash
refarm model current --json
refarm runtime status --json
```

Se os homes diferirem, alinhe `SILO_HOME` e `REFARM_HOME` para o mesmo escopo operacional.

**3. O prompt precisa dar a posição exata.** Pedir ao agente que "encontre o símbolo X" o faz estimar
linha e coluna a partir da leitura do arquivo, e ele erra por algumas linhas — a ferramenta então
responde sobre outra coisa. Passar `file`, `line` e `column` isola o que se quer demonstrar:

```bash
L=$(grep -n "export async function createLiveFetch" packages/browser-driver/src/session.ts | cut -d: -f1)
node scripts/capture-agent-runtime-record.mjs --prompt "Use a ferramenta code-ops find-references com \
file=$PWD/packages/browser-driver/src/session.ts, line=$L, column=23. Responda quantas referências \
foram encontradas e liste arquivo e linha de cada uma."
```

Resultado esperado: duas referências — a declaração e o reexport em `index.ts`. **Uma só significa que
a análise ainda não assentou**, e o servidor não avisa quando isso acontece (ver
`packages/tractor/src/host/lsp_bridge.rs`).

## 1. One declaration → every surface (the invariant)

The spine of the whole system: a verb declared once appears on the CLI, the web, the agent, and the
laid-out terminal faces — with the SAME argument schema validated on each.

| Capture | Command / where | Proves |
| --- | --- | --- |
| PRINT | `<cli> --help` then `<cli> dashboard` | the same verbs as a flat CLI AND a laid-out card grid |
| PRINT | `<cli> dashboard -i` (arrow to a verb, Enter) | interactive navigation + dispatch; an args-verb opens an inline form |
| PRINT | `<cli> status-panel` | operator status as severity-colored stat-cards + Next steps |
| SHOT | the example's web face (`pnpm --filter <example> web:dev`) | the same verbs as web cards / forms |
| PRINT | a bad agent tool call rejected with a field message | "same schema → every surface" now covers the agent leg too (see §4) |

## 2. The TUI layout engine (converge internal + external effort)

The story: adopt the proven engine (Yoga flex, string-width metrics), author only what is genuinely
unserved (terminal projection). Same shape as the DTCG + Style-Dictionary token pipeline.

| Capture | Command / where | Proves |
| --- | --- | --- |
| PRINT | `<cli> dashboard` (wide + narrow terminal) | responsive wrapping card grid — flex, not a fixed list |
| PRINT | `reqbench-t3` a records/requirements **table** (aligned columns) | `renderTable` — the second high-use shape the engine unlocks |
| SHOT | the web `<table>` twin of that same data | `renderTableHtml` — one data declaration → TUI table + accessible web table |
| FILE | `docs/superpowers/plans/2026-07-19-tui-layout-engine.md` + `-tui-interactivity.md` | the plan-first record: adopt-vs-build gates, executed |

## 3. T1 — devbench-t1: the machine shows itself (agent / runtime)

The coding-agent bench, `live-*` verbs execute on the REAL WASM runtime (see `EVIDENCE.md`: REAL vs
SYNTHETIC).

| Capture | Command / where | Proves |
| --- | --- | --- |
| PRINT | `<cli> agent-telemetry --mock` | a real multi-turn agent run; the timeline from the runtime's own `agent:*` events |
| SHOT | `t1-agent-plugin-and-lsp-flow` | the agent as a runtime plugin, extended by a second plugin (`lsp-code-ops`) rather than a black-box chatbot |
| SHOT | `t1-agent-telemetry-trace` | route, iterations, tool calls, host effects, and tokens as a causal run trace |
| SHOT | `t1-lsp-code-ops-value` | tangible agentic value: LSP-backed references + semantic rename, useful as the base of vulnerability/debt triage |
| SHOT | the `agent-telemetry` web face | the run timeline as an accessible Metric/Value `<table>` |
| PRINT + SHOT | `<cli> plugin-catalog` | the Barn's sovereign inventory (plugin · cache · sha256) — TUI + web table |
| FILE | `enforce-evidence.json` (SHA-256 stamped) + `EVIDENCE.md` | the honest evidence ledger — what is REAL, what it emits, the limits |
| PRINT | `<cli> live-recursion` / `live-delegation` | plugin→plugin + agent→agent dispatch on the live runtime |

## 4. Rust — the sovereign runtime (do not leave it out of the story)

| Capture | Command / where | Proves |
| --- | --- | --- |
| PRINT | a plugin→plugin (`call_plugin`) call with bad args, rejected `InvalidSchema` | validation parity extended to the SPI — the 6th path, plugin→plugin |
| PRINT | an agent tool call with a wrong-typed arg, rejected before dispatch | the agent leg validates against the verb's declared schema (jsonschema, host-side) |
| FILE | `git log` of the `feat(tractor)` commits | the schema now guards web + HTTP + CLI + TUI + agent + plugin→plugin |

## 5. T2 / T3 — the products (result mode)

| Capture | Command / where | Proves |
| --- | --- | --- |
| PRINT/SHOT | `wallet-t2` (`dgk wallet`) — held items, verify, present | the citizen sees held items, not the machine (result mode) |
| PRINT/SHOT | `reqbench-t3` — login + fetch + records as a table/panel | requirements as a laid-out table + status panel |
| FILE | each example's `EVIDENCE.md` + report material (disclosure SVG, report.md) | the honest ledger + the record artifacts |

## Records to keep (the durable trail)

- **Plans** (`docs/superpowers/plans/2026-07-19-*.md`) — the adopt-vs-build gates, executed.
- **Verdict** (`docs/research/2026-07-18-reinventing-the-wheel-ds-i18n-a11y.md`) — what was adopted vs authored.
- **EVIDENCE.md** per example — REAL vs SYNTHETIC + limits.
- **Emitted artifacts** — `enforce-evidence.json` (SHA-256), disclosure SVGs, `report.md`.
- **Git history** — atomic commits are the change record (nothing is a version bump; all 0.1.0).

> Tip for the writing: each row's "Proves" column is a ready caption. Pair the PRINT/SHOT with it and the
> narrative writes itself: declare once → project everywhere → validate the same schema on every surface,
> adopting proven engines and authoring only the projection.
