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

Resultado: **passou** para `storage-contract-v1`, `sync-contract-v1`, `identity-contract-v1`, `plugin-manifest`, `storage-sqlite`, `storage-memory`, `storage-rest`, `sync-loro`, `sync-crdt` e `identity-nostr`.

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
| `storage:v1` | `storage-sqlite`, `storage-memory`, `storage-rest` | ✅ `storage-sqlite/src/storage-v1.conformance.test.ts`, `storage-memory/src/storage-v1.conformance.test.ts`, `storage-rest/src/storage-v1.conformance.test.ts` + scripts `test:conformance` | ✅ malha mínima fechada para os três adapters atuais |
| `sync:v1` | `sync-loro`, `sync-crdt` | ✅ `sync-loro/src/sync-v1.conformance.test.ts` e `sync-crdt/test/sync-v1.conformance.test.ts` usando `runSyncV1Conformance` + cenários de conflito concorrente entre peers | ✅ Cobertura mínima aplicada nos dois adapters atuais |
| `identity:v1` | `identity-nostr` | ✅ `identity-nostr/src/identity-v1.conformance.test.ts` usa `runIdentityV1Conformance` | ✅ Cobertura mínima de create/sign/verify/get validada |
| `plugin-manifest` | `plugin-manifest` | ✅ `src/validate.test.js` + script `test:conformance` (validação schema/rules) | ℹ️ Escopo formalizado: conformance por schema no `manifest:v1` |

## Plano de cobertura priorizado

### P0 (desbloqueio de runtime/contracts)
1. **T-CONTRACT-04** concluída: conformance em `identity-nostr` e escopo de conformance de `plugin-manifest` formalizado.

### P1 (fechamento da malha de sync/storage)
2. **T-CONTRACT-05** concluída: `sync-crdt` integrado ao harness `runSyncV1Conformance` e ao gate `test:capabilities`.
3. **T-CONTRACT-02** concluída: conformance expandida para `storage-memory` e `storage-rest` além de `storage-sqlite`.

## Observação de dependência

`T-RUNTIME-04` depende de `T-CONTRACT-03`; com `T-CONTRACT-05` concluída, a malha principal de conformance sync está fechada para os adapters atuais e reduz risco de regressão no roundtrip runtime/storage.
