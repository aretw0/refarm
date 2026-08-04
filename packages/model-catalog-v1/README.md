# @refarm.dev/model-catalog-v1

Pacote canonico para catalogo de tarifacao de modelos (provider, regra de match, janela temporal e fonte oficial).

Objetivo: separar dado mutavel de precificacao da logica de runtime, reduzindo drift entre Rust, TypeScript e CI.

## Estrutura

- `catalog/model-rates.v1.json`: snapshot canonicamente versionado.
- `src/index.ts`: tipos, validacao e resolvedor por provider/modelo/data.

## Contrato

- `schemaVersion`: `model-rate-catalog.v1` (compatibilidade) ou `model-tariff-catalog.v1` (nomenclatura desacoplada)
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

## Nota de compatibilidade

Para nao quebrar consumidores existentes, a API antiga baseada em `rate` permanece disponivel.
Novos consumidores devem preferir as APIs de `tariff` (`ModelTariffCatalog`, `resolveModelTariff`, `validateModelTariffCatalog`).
