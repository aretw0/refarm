# Trabalhos (Prêmio) — material de escrita por trabalho

Este índice liga cada trabalho ao seu **exemplo executável** (a prova) e à **postura de escrita**
(os guias `POC_*.md`). Os documentos aqui são enxutos: **apontam** para o material que já existe
(READMEs dos exemplos, diagramas SVG, o verbo `report`, os testes de execução), sem copiá-lo.

> **Nota honesta:** não há edital/briefing formal do prêmio no repositório. A fonte de "o que cada
> trabalho pede" é a seção **Focus** do README de cada exemplo. Requisitos formais, se necessários,
> são input externo.

| Trabalho | Exemplo (a prova) | Tema (postura de escrita) | Doc |
|---|---|---|---|
| **T1 — Plugins WASM / máquina extensível** | [`examples/devbench-t1`](../../examples/devbench-t1/README.md) | "Extension sandbox" (Theme 1) | [T1-devbench.md](T1-devbench.md) |
| **T2 — Cidadão Digital / carteira soberana** | [`examples/wallet-t2`](../../examples/wallet-t2/README.md) | "Citizen data wallet" (Theme 2) | [T2-wallet.md](T2-wallet.md) |
| **T3 — Caixa de Notas / vault de requisitos** | [`examples/reqbench-t3`](../../examples/reqbench-t3/README.md) | "Governed note box" (Theme 3) | [T3-reqbench.md](T3-reqbench.md) |

## Como usar

1. **O que o trabalho pede** e **como o exemplo prova** — cada doc por-trabalho, destilado do README.
2. **Figuras** — `examples/<trabalho>/diagrams/{composition,flow}.svg` (arquitetura + fluxo).
3. **Números** — gere com `dgk report --apply` (T1/T2) ou `dgk requirements-report --apply` (T3);
   sai em `.dgk/report/` (efêmero) com os valores reais da execução.
4. **Postura de escrita** — os guias gerais, atemporais:
   - [POC_WRITING_HANDOFF.md](../POC_WRITING_HANDOFF.md) — claim promotion, narrative placement, non-claims.
   - [POC_PRIZE_READINESS.md](../POC_PRIZE_READINESS.md) — a matriz problema → evidência → limite.
   - [POC_DEMONSTRATION_PACKET.md](../POC_DEMONSTRATION_PACKET.md) — o template de "packet" de demonstração.

> Os `POC_*.md` foram escritos na era das fixtures sintéticas (`validations/*-poc/`), anteriores aos
> exemplos executáveis. A evidência canônica hoje vive em `examples/<trabalho>/` — os `POC_*.md`
> seguem valendo como guia de **postura**, não de evidência.
