# Conformance v1 Inventory (2026-04-23)

## Scope
Inventory das suites de conformance relacionadas aos contratos v1:

- `@refarm.dev/storage-contract-v1`
- `@refarm.dev/sync-contract-v1`
- `@refarm.dev/identity-contract-v1`
- `@refarm.dev/plugin-manifest`

Com foco adicional nos adapters atuais que deveriam consumir essas suites.

## Evidência executada

```bash
npm run test:capabilities --silent
```

Resultado: **passou** para `storage-contract-v1`, `sync-contract-v1`, `identity-contract-v1`, `plugin-manifest`, `storage-sqlite` e `sync-loro`.

## Inventário por pacote de contrato

| Pacote | Runner de conformance | Suite de referência no pacote | Status atual |
|---|---|---|---|
| `storage-contract-v1` | `runStorageV1Conformance` (`src/conformance.ts`) | `src/conformance.test.ts` | ✅ Presente e executando |
| `sync-contract-v1` | `runSyncV1Conformance` (`src/conformance.ts`) | `src/conformance.test.ts` | ✅ Presente e executando |
| `identity-contract-v1` | `runIdentityV1Conformance` (`src/conformance.ts`) | `src/conformance.test.ts` | ✅ Presente e executando |
| `plugin-manifest` | _não existe runner de conformance v1_ | `src/validate.test.js` (validação de schema/regras) | ⚠️ Apenas testes unitários, sem harness de conformance |

## Inventário por adapter (consumo das suites)

| Contrato | Adapters mapeados | Evidência de conformance hoje | Lacuna |
|---|---|---|---|
| `storage:v1` | `storage-sqlite`, `storage-memory`, `storage-rest` | ✅ `storage-sqlite/src/storage-v1.conformance.test.ts` + script `test:conformance` | ❗ `storage-memory` e `storage-rest` ainda sem teste de conformance explícito |
| `sync:v1` | `sync-loro`, `sync-crdt` | ✅ `sync-loro/src/sync-v1.conformance.test.ts` usa `runSyncV1Conformance` + cenário de conflito concorrente entre peers | ⚠️ `sync-crdt` ainda sem suite de conformance com `runSyncV1Conformance` |
| `identity:v1` | `identity-nostr` | ⚠️ Não há teste de conformance no pacote | ❗ Falta suite usando `runIdentityV1Conformance` |
| `plugin-manifest` | `plugin-manifest` | ✅ `src/validate.test.js` (9 testes) | ❗ Falta definir contrato/harness de conformance (se escopo exigir paridade com contratos v1) |

## Plano de cobertura priorizado

### P0 (desbloqueio de runtime/contracts)
1. **T-CONTRACT-04**: adicionar conformance em `identity-nostr` e decidir formalmente o escopo de conformance para `plugin-manifest`.

### P1 (fechamento da malha de sync/storage)
2. Follow-up curto: avaliar inclusão de `sync-crdt` no harness `runSyncV1Conformance`.
3. **T-CONTRACT-02**: expandir conformance para `storage-memory` e `storage-rest` além de `storage-sqlite`.

## Observação de dependência

`T-RUNTIME-04` depende de `T-CONTRACT-03`; portanto, completar a trilha `T-CONTRACT-*` é o caminho mais seguro para reduzir risco no roundtrip runtime/storage.
