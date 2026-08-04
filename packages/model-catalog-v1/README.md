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
  - `unpriced.reason` / `unpriced.checkedAt` / `unpriced.note` (opcional)
  - `pricingUrl`
  - `verifiedAt`
  - `effectiveFrom`/`effectiveTo` (opcional)

Exatamente um entre `rate` e `unpriced` deve estar presente. `unpriced` e o terceiro estado do
catalogo: modelo conhecido cuja tarifa o fornecedor nao publica, registrada com motivo e data em
vez de silencio. Sem esse estado, um id nao verificado ainda casa com a regra `contains` da sua
familia e recebe um preco plausivel por associacao (foi o caso de `gpt-5.1-codex-mini` sob a regra
`gpt-5`). Regras mais especificas vem ANTES da regra de familia, porque a resolucao e
first-match-wins.

`resolveModelTariff`/`resolveModelRate` respondem tres coisas: `undefined` (nenhuma entrada casou),
resultado com `tariff`/`rate` (tarifa verificada) e resultado sem ela (entrada casou e nao carrega
tarifa de proposito).

## Nota de compatibilidade

Para nao quebrar consumidores existentes, a API antiga baseada em `rate` permanece disponivel.
Novos consumidores devem preferir as APIs de `tariff` (`ModelTariffCatalog`, `resolveModelTariff`, `validateModelTariffCatalog`).
