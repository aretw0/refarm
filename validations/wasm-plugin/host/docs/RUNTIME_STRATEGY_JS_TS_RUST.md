# Runtime Strategy: JS/TS-first + Rust/WASM for Critical Paths

## Objetivo

Maximizar velocidade de entrega sem perder capacidade de isolamento/performance quando necessario.

## Estrategia recomendada

1. Produto e UX: JS/TS-first.
- Iteracao mais rapida.
- Tooling e observabilidade mais simples.

2. Caminhos criticos: Rust/WASM.
- Isolamento de execucao.
- Melhor previsibilidade para codigo sensivel a performance.

3. Contrato unico de integracao.
- Interface comum para modulos JS e WASM.
- Capabilities explicitadas pelo host.

## Quando usar JS/TS puro

- Prototipo de features.
- Integracoes com APIs web sem necessidade de sandbox estrito.
- Fluxos com alta mudanca de requisitos.

## Quando usar Rust/WASM

- Computacao pesada.
- Codigo que exige encapsulamento forte.
- Regras que devem ficar mais rigidamente controladas.

## Decisao para Refarm (proposta)

- Nao abandonar Rust.
- Operar em modo hibrido:
  - Default de desenvolvimento: JS/TS.
  - Trilho de producao para partes sensiveis: Rust/WASM.

## Criterios de migracao JS -> WASM

Migrar um modulo para WASM quando houver pelo menos 2 sinais:
- gargalo de performance recorrente;
- necessidade de isolamento adicional;
- estabilidade de contrato funcional;
- maturidade de testes e telemetria.
