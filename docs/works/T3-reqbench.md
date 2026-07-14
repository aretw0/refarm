# T3 — Caixa de Notas / vault de requisitos (reqbench)

Exemplo: [`examples/reqbench-t3`](../../examples/reqbench-t3/README.md) · Tema (postura): "Governed
note box" ([Theme 3](../POC_WRITING_HANDOFF.md)).

## O que o trabalho pede

Persona = **analista de requisitos**; **result mode** — o analista lê um produto acabado (um MOC
navegável de requisitos), nunca a máquina. "O trabalho com mais material a mostrar." O analista
começa um vault do zero, descobre os sistemas que acessa, raspa, corrige, enriquece, e lê o MOC —
com uma face Astro sobre os requisitos raspados (o equivalente ao `modelo-de-repositorio-para-
requisitos` da SERPRO, em Astro). (Fonte: seção *Focus* do README do exemplo.)

## Como o exemplo prova (verbos + testes)

- **Scraping ao vivo** — `source discover` · `requirements-pull`/`requirements-crawl` (OSLC/RDF com
  login SSO, `--live`); multi-source (dois ALMs agregam num vault, roteados por sistema).
- **Curadoria** — `records enrich` (regras de domínio do analista) · `records correct` (que agora
  entra no histórico).
- **Materialização** — `requirements-organize` (PARA) · `requirements-materialize` (notas Obsidian
  com rastreabilidade + anexos content-addressed).
- **Análise sobre o corpus** — `requirements-search` (texto + faceta) · `requirements-health`
  (órfãos/duplicados/danglings, cross-record) · `requirements-history`/`-diff` (o que mudou entre
  pulls) · `requirements-overview` (o vault numa visão) · `requirements-lab` (Marimo).

Rastreabilidade vem dos próprios requisitos: o parser OSLC/RDF extrai os predicados de link como
relações tipadas, que viram arestas do grafo e sobrevivem na nota materializada.

## Figuras

- [`diagrams/composition.svg`](../../examples/reqbench-t3/diagrams/composition.svg) — arquitetura (app do analista + SDK genérico).
- [`diagrams/flow.svg`](../../examples/reqbench-t3/diagrams/flow.svg) — a jornada (múltiplos ALMs → puxar → organizar → materializar → analisar).
- O grafo de requisitos: `dgk requirements-graph --svg`.

## Números

```bash
pnpm --filter reqbench-t3 dgk requirements-report --apply   # → .dgk/report/T3-report.md
```

O `report.md` traz os valores reais: cobertura por sistema/tipo/status, rastreabilidade (relações +
anexos), saúde do corpus, e o histórico. Cada afirmação tem um teste que a comprova.

## Postura de escrita

Ver [POC_WRITING_HANDOFF.md](../POC_WRITING_HANDOFF.md) e a linha "Governed note box" em
[POC_PRIZE_READINESS.md](../POC_PRIZE_READINESS.md). **Não dizer:** que há integração de vault de
produção provada — os contratos genéricos (manifest/provenance/vault) são a prova; a UX de vault
fica com o projeto consumidor.
