# SQLite Benchmark Results

**Data**: 2026-03-06  
**Machine**: 11th Gen Intel(R) Core(TM) i9-11900H, 16 vCPUs, Linux 5.15.153.1-microsoft-standard-WSL2  
**Node Version**: v22.16.0

---

## Resultados Brutos

### wa-sqlite

```
Total Time:     1230.82ms
Load Time:      29.38ms
Insert Time:    1142.84ms (87501 ops/sec)
Query Time:     9.42ms
Bundle Size:    ~400KB (estimate)
Memory Usage:   10.3 MB
```

### sql.js

```
Total Time:     561.51ms
Load Time:      10.18ms
Insert Time:    509.34ms (196332 ops/sec)
Query Time:     13.88ms
Bundle Size:    ~700KB (estimate)
Memory Usage:   6.1 MB
```

---

## Comparação

| Métrica | wa-sqlite | sql.js | Vencedor | Diferença |
|---------|-----------|--------|----------|-----------|
| Load Time | 29.38ms | 10.18ms | sql.js | sql.js 65.35% mais rapido |
| Insert Throughput | 87,501 ops/s | 196,332 ops/s | sql.js | sql.js 124.37% maior throughput |
| Query Time | 9.42ms | 13.88ms | wa-sqlite | wa-sqlite 32.13% mais rapido |
| Bundle Size | ~400KB (estimado) | ~700KB (estimado) | wa-sqlite | wa-sqlite 42.86% menor |
| Memory Usage | 10.3 MB | 6.1 MB | sql.js | sql.js 40.78% menor |

---

## Análise

### Pontos Fortes

**wa-sqlite**:

- Melhor tempo de query indexada neste teste.
- Menor estimativa de bundle no setup atual.
- Melhor alinhamento com requisitos de recursos SQLite avancados (WAL/FTS/JSON1).

**sql.js**:

- Melhor tempo de carga e throughput de insercao no benchmark atual.
- Menor uso de memoria no teste Node.

### Pontos Fracos

**wa-sqlite**:

- Insert throughput inferior ao sql.js neste teste especifico.
- Maior uso de memoria no benchmark atual.

**sql.js**:

- Pior tempo de query indexada no teste atual.
- Nao oferece o mesmo nivel de recursos SQLite avancados para roadmap futuro.

---

## Decisão

**Engine escolhido**: wa-sqlite (provisorio)

**Rationale**:

- O benchmark atual em Node/in-memory favoreceu sql.js em carga e inserts, mas nao cobriu OPFS real no browser.
- Os requisitos de produto para v0.1.0 priorizam OPFS e compatibilidade SQLite avancada (WAL/FTS/JSON1), onde wa-sqlite segue melhor alinhado.
- A decisao permanece provisoria ate benchmark em browser com OPFS VFS real.

**Trade-offs aceitos**:

- Aceitamos throughput menor no benchmark in-memory de Node em troca de maior alinhamento arquitetural com OPFS.
- Mantemos sql.js como fallback para PoC caso haja bloqueio operacional no wa-sqlite em browser.

---

## Próximos Passos

- [x] Atualizar ADR-015 com esta decisão
- [ ] Integrar engine escolhido em `@refarm/storage-sqlite`
- [ ] Testar OPFS persistence em browser host (faltante)
- [ ] Validar quota management
