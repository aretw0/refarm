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
- [ ] Documentar resultados em `wasm-plugin/results.md`

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
