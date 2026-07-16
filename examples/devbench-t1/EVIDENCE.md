# Bancada de Plugins WASM — o que este exemplo prova

Registro honesto do que a bancada **demonstra em execução** e do que **não** pode ser afirmado. A regra
aqui é separar duas faixas: o que **executa no runtime WASM real** (o host Rust `tractor`/wasmtime, com
`agent.wasm` e `crash-plugin.wasm` reais) e o que é **prova sintética** (matriz de decisão de política,
sem WASM). Cada linha aponta o verbo, o teste que a comprova e o arquivo.

> Os testes de execução ao vivo são _gated_ (`RUN_RUNTIME_EXECUTION=1` + artefatos buildados) em
> `src/*.execution.test.ts`. Sem o gate, um `pnpm test` os pula a custo zero.

## Faixa A — executado no runtime WASM real

| Capacidade | O que prova (frase honesta) | Selo | Como prova |
|---|---|---|---|
| `governance-enforce` | Sob modo estrito, um efeito **não declarado** é **recusado na fronteira** do sandbox (nenhuma linha `host-effect:fs:read` no audit), contrastado com um baseline concedido que produz o efeito. É o host **recusando de fato** — não um parecer. | **REAL** (única sob `strict`) | `enforce.execution.test.ts` boota o host Rust; o A/B (denied×baseline) em `live-enforce.ts:runEnforce`. Espera o evento terminal do run **antes** de checar o efeito (determinístico, não corrida). |
| `governance-enforce --apply` | A recusa real é **persistida como evidência de runtime** — `.dgk/enforce/enforce-evidence.json` com carimbo **SHA-256** dos bytes + manifesto `evidence.json`. Evidência de uma recusa que **aconteceu**, não um literal. | **REAL** | `live-enforce.ts` usa os helpers de carimbo do host (`stampEvidence` / `writeEvidenceFiles`); o teste gated dirige `--apply` e confere arquivo + stamp + manifesto. |
| `agent-run` | Recursão **host-mediada**: o coding-agent (plugin WASM) chama o verbo de **outro** plugin (o source provider) como ferramenta, via `call_plugin` — sem privilégio próprio, o host media. A ferramenta chamada é **observada** no audit (`agent:tool:call`), não afirmada. | **REAL** | `recursion.execution.test.ts` (2 testes); `live-recursion.ts` lê `agent:tool:call` do trilho (`toolCalled = "source-discover"`). |
| `delegate-run --chain` | Um plugin (`delegate`, WASM sandboxado) orquestra o agent sob uma persona, via `call_plugin` — plugin→plugin, nenhum privilegiado. A saída é conferida por **conteúdo**. | **REAL** | `delegation.execution.test.ts`; `live-delegation.ts`. |
| `code-ops` | Rename / find-references chegam como **extensão WASM carregada** (`lsp-code-ops`), não embutida no host — o que a superfície de IDE contribui, provado ponta a ponta contra um LSP falso autocontido. | **REAL** | `code-ops.execution.test.ts`; `live-code-ops.ts`. |
| `plugin-resilience` | Um plugin em **loop infinito** (`crash-plugin.wasm`, `on_event` que gira para sempre) é **trapado** pelo orçamento de época e **reinstanciado** pelo supervisor; o agent **responde depois** (evento `agent:response:done` observado no audit). O host nunca para de servir. | **REAL** | `resilience.execution.test.ts`; `live-resilience.ts` — sobrevivência derivada de evento real, não de campo hardcoded. |
| `governance-audit` | O host escreve uma **trilha de auditoria** de cada efeito real (`scarecrow-audit.ndjson`); o verbo boota o agent ao vivo, dispara um efeito de `fs` e lê a trilha que o **host** escreveu. | **REAL** (sob `securityMode: none`) | `audit.execution.test.ts`; `live-audit.ts`. Prova a **trilha**, não a recusa de capacidade. |
| `plugin-reload` | **Hot-reload** de um plugin carregado sem reiniciar o host (`POST /plugins/reload` → troca de código real), e ele segue despachando. | **REAL** (sob `securityMode: none`) | `reload.execution.test.ts`; `live-reload.ts`. |
| `agent-telemetry [--with-effects]` | A **timeline** de um run projetada dos eventos `agent:*` do próprio runtime — rota do modelo (e por quê), cada iteração, cada tool-call, tokens finais. Com `--with-effects`, correlaciona cada tool-call ao `host-effect` que disparou. | **REAL** (sob `securityMode: none`) | `telemetry.execution.test.ts`; `parseAgentTimeline` em `live-telemetry.ts` (puro, testado offline). |
| `plugin-resolve` | Um plugin **é** seu SHA-256 (content-addressed); bytes adulterados são **rejeitados** (hash-mismatch). | **REAL** (verificação de hash) | `plugin-resolve` + teste correspondente. |

> **Nuance obrigatória (o teto de claim do T1):** dos verbos da Faixa A, **apenas `governance-enforce`
> roda sob `securityMode: "strict"`** — o único que prova **recusa de capacidade** na fronteira. Os
> demais rodam sob `securityMode: "none"` e provam **auditoria, hot-swap, epoch-trap, observabilidade e
> recursão** no runtime WASM real — **não** governança de capacidade. Afirmar "N verbos executam
> governança" seria overclaim; a frase honesta é "um verbo executa a recusa; os outros executam o
> substrato do runtime".

## Faixa B — prova sintética (sem WASM)

| Capacidade | O que prova | Selo | Artefatos |
|---|---|---|---|
| `governance-poc` | Extensibilidade como **decisão de risco**: 2 modos de política × 3 extensões → decisões de política, relatórios de sandbox, evidência de runtime **sintética**, métricas e um scorecard. A função forçante que produz artefatos revisáveis. | **SINTÉTICO** | `.dgk/governance/*.policy-decision.json`, `*.sandbox-report.json`, `*.runtime-evidence.json`, `scorecard.json`, `metrics.json` (`governance-verb.ts`). |
| `plugin-catalog` / `plugin-ops` | Inventário verificado da Barn / dashboard unificado (agrega os blocos daemon-free). | derivado | — |

## Artefatos produzidos

- **`dgk report --apply`** → `.dgk/report/` (o grafo SPI como `.svg` + um `T1-report.md` com os números
  reais) **e** `.dgk/report/evidence.json` (manifesto que liga cada arquivo ao SHA-256 dos seus bytes).
- **`dgk governance-enforce --apply`** → `.dgk/enforce/enforce-evidence.json` (o A/B de uma recusa **real**
  no host Rust) + `.dgk/enforce/evidence.json` (carimbo SHA-256). **Esta é a evidência de runtime genuína**,
  distinta da sintética do `governance-poc`.
- **`dgk governance-poc --apply`** → `.dgk/governance/` (os artefatos sintéticos da matriz de decisão).
- Figuras estáticas: `diagrams/composition.svg` (arquitetura), `diagrams/flow.svg` (governança executada + resiliência).

## Limites honestos

- **Host único de desenvolvimento.** Não há certificação de isolamento completo; a prova é local e verificável.
- **O LLM é mockado** (`ModelMockServer`). O escopo honesto de qualquer legenda é **enforcement de
  capacidade host-side** e o ciclo do runtime — **não** uma rodada de modelo real ponta a ponta.
- **Poliglota é propriedade da spec** do Component Model, não algo demonstrado aqui: **todo plugin é Rust**.
  Um plugin Go existe apenas como README (não buildado).
- **Sem benchmark comparativo de latência.** Há baselines absolutos em `packages/tractor/benchmarks`
  (números reais, mas auto-referenciais) — não uma comparação com containers.
- A camada real depende de artefatos buildados (`agent.wasm`, `source_provider.wasm`, `crash-plugin.wasm`,
  o binário `tractor`). Sem eles, os verbos ao vivo retornam um erro `artifacts_missing` acionável.
