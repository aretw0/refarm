# @refarm.dev/model-catalog-v1

Pacote canonico para catalogo de precificacao de modelos (provider, regra de match, janela temporal e fonte oficial).

Objetivo: separar dado mutavel de precificacao da logica de runtime, reduzindo drift entre Rust, TypeScript e CI.

## Estrutura

- `catalog/model-rates.v1.json`: snapshot canonicamente versionado.
- `src/index.ts`: tipos, validacao e resolvedor por provider/modelo/data.

## Contrato

- `schemaVersion`: `model-rate-catalog.v1`
- `catalogVersion`: versao do snapshot
- `entries[]`:
  - `provider`
  - `match.mode`: `contains` ou `exact`
  - `match.value`
  - `rate.inputPerMTokenUsd`
  - `rate.outputPerMTokenUsd`
  - `pricingUrl`
  - `verifiedAt`
  - `effectiveFrom`/`effectiveTo` (opcional)
