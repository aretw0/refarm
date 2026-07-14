# T1 — Plugins WASM / a máquina extensível (devbench)

Exemplo: [`examples/devbench-t1`](../../examples/devbench-t1/README.md) · Tema (postura): "Extension
sandbox" ([Theme 1](../POC_WRITING_HANDOFF.md)).

## O que o trabalho pede

Persona = **desenvolvedor**; **process mode** — mostrar a MÁQUINA sendo estendida, não um produto
pronto. "Declare uma vez → aparece em todo lugar" (CLI · TUI · web · IDE de uma só declaração).
Uma extensão (coding-agent) já existe como plugin; T1 demonstra **instalar e estender**, com a
governança da extensibilidade **executada em sandbox**, não afirmada.
(Fonte: seção *Focus* do README do exemplo.)

## Como o exemplo prova (verbos + testes ao vivo)

- **Recursão host-mediada** — `agent-run`, `delegate-run --chain`, `code-ops`. Um plugin declara
  `requiresApi`, o host resolve quem `providesApi`, e a chamada cruza a fronteira via `call_plugin`.
- **Governança executada (quarteto)** — `governance-poc` (DECIDE) · `governance-audit` (REGISTRA) ·
  `governance-enforce` (RECUSA um efeito não-declarado sob strict) · `plugin-resilience` (isola/
  reinstancia um plugin em loop) — provado no runtime Rust, não em texto.
- **Runtime tinkering** — `plugin-reload` (hot-reload sem reiniciar o host).
- **Observabilidade** — `agent-telemetry --with-effects` (a timeline do run correlaciona cada
  tool-call ao host-effect que disparou).
- **Provência / catálogo** — `plugin-resolve` (content-address; bytes adulterados rejeitados) ·
  `plugin-catalog` (inventário verificado) · `plugin-ops` (o dashboard unificado).

Testes de execução ao vivo (gated `RUN_RUNTIME_EXECUTION=1`): `enforce`, `reload`, `resilience`,
`telemetry`, `delegation`, `recursion`, `audit`, `code-ops` — em `src/*.execution.test.ts`.

## Figuras

- [`diagrams/composition.svg`](../../examples/devbench-t1/diagrams/composition.svg) — arquitetura em camadas.
- [`diagrams/flow.svg`](../../examples/devbench-t1/diagrams/flow.svg) — a governança executada + resiliência.
- `dgk report --apply` → `.dgk/report/spi-graph.svg` (grafo SPI, arestas executadas vs ilustrativas).

## Números

```bash
pnpm --filter devbench-t1 dgk report --apply   # → .dgk/report/T1-report.md + spi-graph.svg
```

O `report.md` traz os valores reais: quantas arestas SPI são EXECUTADAS pelo runtime (não só
desenhadas) e o scorecard de governança (score + gate). Cada afirmação tem um teste que a comprova.

## Postura de escrita

Para promover claims sem overclaim, ver [POC_WRITING_HANDOFF.md](../POC_WRITING_HANDOFF.md)
(Claim Promotion Rule, non-claims) e a linha "Extension sandbox" na Proposal Evidence Matrix de
[POC_PRIZE_READINESS.md](../POC_PRIZE_READINESS.md). **Não dizer:** que a governança de plugins de
produção está resolvida, ou que há deploy institucional — o exemplo é uma prova local e verificável.
