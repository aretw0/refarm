# ADR-062 — Cloudflare Provider Package (`packages/infra-cloudflare`)

**Status:** Proposed  
**Date:** 2026-05-08  
**Author:** Arthur Silva

## Context

`packages/infra-turbo-cache` começou como implementação Cloudflare da plataforma — um Cloudflare Worker + R2 que implementa o Turborepo Remote Cache API v8. A fronteira foi refinada: `turbo-cache` é o bloco semântico provider-neutral, enquanto Cloudflare Worker + R2 é apenas o primeiro adaptador. O deploy é hoje manual (wrangler CLI ad-hoc). O `sow` command já coleta e armazena o Cloudflare API Token via `SowerCore`, mas esse token não é aproveitado para provisionamento automatizado de recursos.

Dois problemas se revelam:

1. **Fragmentação**: serviços Cloudflare futuros (`packages/infra-cloudflare-kv`, `packages/infra-cloudflare-pages`, …) precisariam de pacotes separados sem contexto compartilhado de provedor (account ID, token, utilitários wrangler).
2. **Provisionamento manual**: usuários do Refarm precisam rodar cinco comandos wrangler na mão — exatamente o tipo de fricção que o Refarm deve eliminar.

## Decisão

Criar `packages/infra-cloudflare/` como envelope canônico do provedor Cloudflare, com três responsabilidades:

1. **Provider context** compartilhado — account ID, token, resolução/execução de `wrangler`, tipos comuns
2. **Provider adapters** por bloco semântico (ex.: turbo-cache em Cloudflare Worker + R2)
3. **Service blocks provider-neutral** permanecem em pacotes próprios (ex.: `packages/infra-turbo-cache`) para permitir AWS/Vercel/etc. no futuro

`packages/infra-cloudflare/` implementa o adaptador Cloudflare para o bloco `packages/infra-turbo-cache/`; o bloco semântico não depende de Cloudflare nem de `wrangler`.

### Estrutura resultante

```
packages/infra-cloudflare/
  src/
    provider.ts              ← CloudflareProvider: resolve token + account ID do identity store
    services/
      turbo-cache/
        worker/index.ts      ← Worker code (Turborepo Remote Cache API v8) — inalterado
        worker/wrangler.toml ← wrangler config do serviço
        provision.ts         ← CloudflareTurboCacheProvisioner (bucket create, secret put, deploy)
    index.ts                 ← re-exports: CloudflareProvider, CloudflareTurboCacheProvisioner
  package.json               ← @refarm.dev/infra-cloudflare

packages/infra-turbo-cache/
  src/
    manifest.ts              ← identidade provider-neutral do bloco turbo-cache
    plan.ts                  ← requisitos provider-neutral: storage, endpoint, auth, CI secrets
    index.ts                 ← re-exporta manifesto/plano sem importar Cloudflare
```

### Convenção para novos adaptadores Cloudflare

Cada adaptador dentro de `packages/infra-cloudflare/src/services/<name>/` expõe:

| Arquivo                | Papel                                                                    |
| ---------------------- | ------------------------------------------------------------------------ |
| `worker/index.ts`      | ExportedHandler — código que roda na Cloudflare edge, quando aplicável   |
| `worker/wrangler.toml` | Configuração wrangler do Worker, quando aplicável                        |
| `provision.ts`         | `Cloudflare<Service>Provisioner` — idempotente, usa `CloudflareProvider` |

## Alternativas consideradas

**A — Pacotes separados por serviço** (`infra-turbo-cache`, `infra-cloudflare-kv`, …)  
Versionamento independente, mas sem contexto de provedor compartilhado. Cada pacote repetiria boilerplate de auth e wrangler. Descartado.

**B — Envelope por provedor (escolhido)**  
Um pacote `infra-cloudflare` agrupa todos os serviços do provedor. Compartilha `CloudflareProvider`, utilitários wrangler, tipos da API. Custo: não há — todos os pacotes são `private: true` e versionados juntos no monorepo.

**C — Apenas orquestrador**  
`infra-cloudflare` como meta-package que importa pacotes individuais. Mais flexível no papel, mas cria indireção desnecessária para um monorepo privado.

## Consequências

- `packages/infra-turbo-cache` permanece como bloco semântico provider-neutral
- `packages/infra-cloudflare` passa a ser a dependência referenciada em `apps/refarm` para execução Cloudflare do provision command
- Novos adaptadores Cloudflare (KV, Workers AI, Pages, turbo-cache) entram como sub-serviços sem criar novos pacotes
- A convenção de manifesto abre caminho para um registry de blocos que o CLI pode descobrir dinamicamente
