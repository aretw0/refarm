# ADR-062 — Cloudflare Provider Package (`packages/infra-cloudflare`)

**Status:** Proposed  
**Date:** 2026-05-08  
**Author:** Arthur Silva  

## Context

`packages/infra-turbo-cache` foi criado como o primeiro serviço Cloudflare da plataforma — um Cloudflare Worker + R2 que implementa o Turborepo Remote Cache API v8. O deploy é hoje manual (wrangler CLI ad-hoc). O `sow` command já coleta e armazena o Cloudflare API Token via `SowerCore`, mas esse token não é aproveitado para provisionamento automatizado de recursos.

Dois problemas se revelam:

1. **Fragmentação**: serviços Cloudflare futuros (`packages/infra-cloudflare-kv`, `packages/infra-cloudflare-pages`, …) precisariam de pacotes separados sem contexto compartilhado de provedor (account ID, token, utilitários wrangler).
2. **Provisionamento manual**: usuários do Refarm precisam rodar cinco comandos wrangler na mão — exatamente o tipo de fricção que o Refarm deve eliminar.

## Decisão

Criar `packages/infra-cloudflare/` como envelope canônico do provedor Cloudflare, com três responsabilidades:

1. **Worker code** por serviço (ex.: turbo-cache) — código que roda na edge  
2. **Provisioning code** por serviço — lógica idempotente de setup (bucket, secret, deploy)  
3. **Provider context** compartilhado — account ID, token, utilitários wrangler, tipos comuns

`packages/infra-turbo-cache/` é movido para dentro de `packages/infra-cloudflare/` como primeiro serviço.

### Estrutura resultante

```
packages/infra-cloudflare/
  src/
    provider.ts              ← CloudflareProvider: resolve token + account ID do identity store
    services/
      turbo-cache/
        worker/index.ts      ← Worker code (Turborepo Remote Cache API v8) — inalterado
        worker/wrangler.toml ← wrangler config do serviço
        provision.ts         ← TurboCacheProvisioner (bucket create, secret put, deploy)
        manifest.ts          ← ServiceManifest: inputs, outputs, pré-requisitos
    index.ts                 ← re-exports: CloudflareProvider, TurboCacheProvisioner
  package.json               ← @refarm.dev/infra-cloudflare
```

### Convenção para novos serviços

Cada serviço dentro de `packages/infra-cloudflare/src/services/<name>/` expõe:

| Arquivo | Papel |
|---|---|
| `worker/index.ts` | ExportedHandler — código que roda na Cloudflare edge |
| `worker/wrangler.toml` | Configuração wrangler do Worker |
| `provision.ts` | `<Service>Provisioner` — idempotente, usa `CloudflareProvider` |
| `manifest.ts` | `ServiceManifest` — nome, inputs, outputs, pré-requisitos |

## Alternativas consideradas

**A — Pacotes separados por serviço** (`infra-turbo-cache`, `infra-cloudflare-kv`, …)  
Versionamento independente, mas sem contexto de provedor compartilhado. Cada pacote repetiria boilerplate de auth e wrangler. Descartado.

**B — Envelope por provedor (escolhido)**  
Um pacote `infra-cloudflare` agrupa todos os serviços do provedor. Compartilha `CloudflareProvider`, utilitários wrangler, tipos da API. Custo: não há — todos os pacotes são `private: true` e versionados juntos no monorepo.

**C — Apenas orquestrador**  
`infra-cloudflare` como meta-package que importa pacotes individuais. Mais flexível no papel, mas cria indireção desnecessária para um monorepo privado.

## Consequências

- `packages/infra-turbo-cache` passa a ser `packages/infra-cloudflare` (migração necessária)
- `packages/infra-cloudflare` passa a ser a dependência referenciada em `apps/refarm` para o provision command
- Novos serviços Cloudflare (KV, Workers AI, Pages) entram como sub-serviços sem criar novos pacotes
- A convenção `ServiceManifest` abre caminho para um registry de serviços que o CLI pode descobrir dinamicamente
