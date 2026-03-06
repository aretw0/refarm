# SQLite Benchmark - wa-sqlite vs sql.js

Benchmark comparativo para decidir qual engine SQLite usar no Refarm.

## Critérios de Avaliação

1. **Performance**: Throughput de inserts/queries (ops/sec)
2. **Bundle Size**: Tamanho do .wasm/.js (impact no load time)
3. **Load Time**: Tempo de inicialização
4. **Memory Usage**: Consumo de memória durante operações
5. **OPFS Support**: Integração com Origin Private File System

## Executar Benchmarks

```bash
# Instalar dependências
npm install

# Rodar todos os benchmarks
npm run bench:all

# Ou rodar individualmente
npm run bench:wa-sqlite
npm run bench:sql-js
```

## Cenários Testados

### 1. Bulk Insert (100k rows)
Simula ingestão massiva de dados de plugins.

### 2. Indexed Query (1k results)
Simula busca por tipo de nó no grafo.

### 3. Memory Footprint
Mede consumo de memória durante operações.

## Targets Esperados

| Métrica | Target | Rationale |
|---------|--------|-----------|
| Load Time | < 200ms | Impacto inicial aceitável |
| Insert Throughput | > 10k ops/sec | Ingestão rápida |
| Query Time | < 50ms | UI responsiva |
| Bundle Size | < 500KB | Não pesar PWA |
| Memory Usage | < 100MB | Browser-friendly |

## Decisão

Após rodar os benchmarks, documentar decisão em:

- [ADR-015](../../specs/ADRs/ADR-015-sqlite-engine-decision.md)
- [storage-sqlite ROADMAP](../../packages/storage-sqlite/ROADMAP.md)

## Próximos Passos

Após escolher o engine:

1. Integrar no `@refarm/storage-sqlite`
2. Adicionar testes de integração com OPFS
3. Validar quota management (ADR-009)
