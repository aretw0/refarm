# Validações Técnicas Pre-Sprint 1

**Data**: 2026-03-06  
**Status**: Em execução  
**Objetivo**: Validar viabilidade técnica de WASM + SQLite antes do Sprint 1

---

## Estrutura

```
validations/
├── wasm-plugin/          # Validação 1: WASM + WIT
│   ├── hello-world/      # Plugin Rust → WASM
│   ├── host/             # TypeScript host para carregar WASM
│   └── results.md        # Resultados + benchmarks
│
└── sqlite-benchmark/     # Validação 2: wa-sqlite vs sql.js
    ├── wa-sqlite.bench.ts
    ├── sql-js.bench.ts
    └── results.md        # Comparação + decisão
```

---

## Checklist de Execução

### Fase 1: WASM + WIT (2 dias)

- [ ] Configurar toolchain Rust (rustup + cargo-component)
- [ ] Criar plugin hello-world (Rust)
- [ ] Compilar para WASM Component
- [ ] Criar PluginHost (TypeScript) no browser
- [ ] Testar capability enforcement
- [ ] Benchmark performance (< 0.1ms per call)
- [ ] Rodar `npm --prefix wasm-plugin/host run test:e2e`
- [ ] Documentar resultados em `wasm-plugin/VALIDATION_RESULTS.md`

### Fase 2: SQLite Benchmark (1 dia)

- [ ] Setup wa-sqlite com OPFS
- [ ] Setup sql.js
- [ ] Benchmark: 100k inserts
- [ ] Benchmark: Querying (indexed vs full scan)
- [ ] Comparar: bundle size, load time, memória
- [ ] Documentar decisão em ADR-015

---

## Execução

**Ordem recomendada (Windows host)**:

1. Rodar `.\setup-rust-toolchain.ps1` (configura Rust + WASM)
2. Entrar em `wasm-plugin/hello-world/` e seguir README
3. Entrar em `wasm-plugin/host/` e testar no browser
4. Entrar em `sqlite-benchmark/` e rodar benchmarks
5. Revisar `results.md` em cada pasta

**Ordem recomendada (Dev Container/Linux)**:

1. Reabrir workspace em container (`Dev Containers: Reopen in Container`)
2. Pular setup PowerShell (post-create já instala toolchain)
3. Entrar em `wasm-plugin/hello-world/` e seguir README
4. Entrar em `wasm-plugin/host/` e testar no browser
5. Entrar em `sqlite-benchmark/` e rodar benchmarks
6. Revisar `results.md` em cada pasta

**Tempo estimado**: 3-4 dias (16-20 horas)

## Comandos Reproduziveis (da raiz do repo)

```bash
pnpm run test:e2e       # Playwright E2E (wasm-plugin/host)
pnpm run bench:sqlite   # Benchmark wa-sqlite vs sql.js
pnpm run validation-pocs:test # POCs sintéticas + manifests + índice
pnpm run validation-pocs:writing-consumer:test # Consumidor de escrita
pnpm run test:repro     # Lint + type-check + unit + integration + e2e
```

## Índice de Evidências POC

`poc-evidence-index.json` é gerado por `pnpm run validation-pocs:index` a
partir dos manifests `refarm.task-artifacts.v1`. Ele serve como mapa de leitura
para consumidores externos: cenário, anexo, scorecard, limites, evidências de
promoção de claims e `writingClaims` por tema.

Cada item de `writingClaims` contém uma afirmação cuidadosa, as evidências
primárias que sustentam a afirmação e o limite de linguagem que ainda não deve
ser ultrapassado. Isso permite que vaults, labs ou ferramentas de escrita usem
o índice sem copiar semântica privada de proposta para dentro do Refarm.

`pnpm run validation-pocs:writing-consumer:test` valida esse contrato do ponto
de vista de um consumidor externo: todas as evidências primárias precisam
resolver para arquivos locais, cada tema precisa expor seus limites de uso, e o
índice deve continuar neutro, sem termos de proposta ou vault privado.
