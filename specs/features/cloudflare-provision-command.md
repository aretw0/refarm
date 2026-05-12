# Feature Spec — `refarm provision` command

**Status:** Proposed  
**Date:** 2026-05-08  
**Depende de:** ADR-062 (infra-cloudflare package)

## Objetivo

Permitir que um usuário do Refarm provisione recursos Cloudflare necessários para a plataforma com um único comando interativo, sem precisar conhecer wrangler, R2 ou a Cloudflare API.

```sh
refarm provision cloudflare turbo-cache
```

## Contexto

`sow` já coleta e persiste o Cloudflare API Token via `SowerCore`. O `provision` command usa esse token armazenado para criar e configurar os recursos na Cloudflare de forma idempotente.

Fluxo hoje (manual, ~5 comandos):

```sh
wrangler r2 bucket create refarm-turbo-cache
openssl rand -hex 32
wrangler secret put AUTH_TOKEN
wrangler deploy
# + adicionar 2 secrets no GitHub manualmente
```

Fluxo alvo:

```sh
refarm sow          # já feito: coleta e persiste cloudflareToken
refarm provision cloudflare turbo-cache
# provisionamento completo; imprime valores para o CI
```

## Interface do usuário

### Subcomando raiz

```
refarm provision <provider> [service] [options]
```

| Argumento       | Descrição                                                    |
| --------------- | ------------------------------------------------------------ |
| `provider`      | Nome do provedor (`cloudflare`, futuramente `aws`, `vercel`) |
| `service`       | Serviço do provedor (`turbo-cache`, `kv`, …). Omitir = todos |
| `--dry-run`     | Mostra o que seria feito sem executar                        |
| `--force`       | Recria recursos existentes                                   |
| `--team <slug>` | Team slug para namespacing (default: `refarm`)               |

### Saída esperada

```
Cloudflare · turbo-cache

  ✔ R2 bucket "refarm-turbo-cache" (already exists)
  ✔ AUTH_TOKEN secret set
  ✔ Worker deployed → https://refarm-turbo-cache.<account>.workers.dev

Próximos passos — adicione estes secrets no seu repositório GitHub:

  TURBO_CACHE_API_URL = https://refarm-turbo-cache.<account>.workers.dev
  TURBO_CACHE_TOKEN   = <gerado automaticamente>

  gh secret set TURBO_CACHE_API_URL --body "..."
  gh secret set TURBO_CACHE_TOKEN   --body "..."
```

## Arquitetura de implementação

### 1. `packages/infra-cloudflare/src/provider.ts`

```ts
export interface CloudflareProviderOptions {
  apiToken: string; // do identity store (SowerCore)
  accountId?: string; // opcional; descoberto via GET /accounts se ausente
}

export class CloudflareProvider {
  readonly apiToken: string;
  readonly accountId: string;

  static async create(
    opts: CloudflareProviderOptions
  ): Promise<CloudflareProvider>;

  // usa execFileNoThrow internamente — nunca exec() com interpolação de string
  exec(
    args: string[],
    cwd: string
  ): Promise<{ stdout: string; stderr: string }>;
}
```

`exec()` deve delegar para `execFileNoThrow` (já existe em `apps/refarm/src/utils/execFileNoThrow.ts`) passando `CLOUDFLARE_API_TOKEN` no env. Nunca interpolar token ou inputs em strings de shell.

### 2. `packages/infra-cloudflare/src/services/turbo-cache/provision.ts`

```ts
export interface CloudflareTurboCacheProvisionInput {
  bucketName: string; // default: "refarm-turbo-cache"
  workerName: string; // default: "refarm-turbo-cache"
  team: string; // default: "refarm"
  authToken?: string; // gerado com crypto.randomBytes(32) se ausente
}

export interface CloudflareTurboCacheProvisionOutput {
  workerUrl: string;
  authToken: string; // valor gerado (para o usuário configurar no CI)
  bucketName: string;
}

export class CloudflareTurboCacheProvisioner {
  constructor(private provider: CloudflareProvider) {}

  async provision(
    input: CloudflareTurboCacheProvisionInput
  ): Promise<CloudflareTurboCacheProvisionOutput>;
}
```

**Passos internos do `provision()`:**

1. `wrangler r2 bucket create <bucketName>` — ignora erro "already exists"
2. Gera `authToken` com `crypto.randomBytes(32).toString("hex")` se não fornecido
3. `wrangler secret put AUTH_TOKEN` (via stdin, nunca via argumento de linha de comando)
4. `wrangler deploy` (cwd: `packages/infra-cloudflare/src/services/turbo-cache/worker/`)
5. Parseia URL do Worker da stdout do deploy
6. Retorna `TurboCacheProvisionOutput`

### 3. `packages/infra-turbo-cache/src/manifest.ts` e `plan.ts`

```ts
export const turboCacheManifest = {
  id: "turbo-cache",
  displayName: "Turborepo Remote Cache",
  description: "Provider-neutral Turborepo Remote Cache service block",
  ciSecrets: ["TURBO_CACHE_API_URL", "TURBO_CACHE_TOKEN"],
};

export const plan = createTurboCacheServicePlan({ team: "refarm" });
```

O manifesto e o plano do bloco semântico vivem em `infra-turbo-cache` e não importam Cloudflare. As formas genéricas (`ManagedServicePlan`, `ProviderProvisionPlan`) vivem em `infra-contract-v1`. O plano declara requisitos provider-neutral (storage de artefatos, endpoint HTTP, bearer auth e secrets CI). O adaptador Cloudflare em `infra-cloudflare` referencia esse plano e o materializa como R2 bucket, Worker e secret `AUTH_TOKEN`.

### 4. `apps/refarm/src/commands/provision.ts`

Segue o mesmo padrão de `sow.ts`:

- `Command("provision")` com subcomando `cloudflare`
- Carrega `cloudflareToken` do identity store via `SowerCore.load()`
- Instancia `CloudflareProvider.create({ apiToken })`
- Despacha para o `Provisioner` do serviço selecionado
- Imprime output + comandos `gh secret set` prontos para copiar

## Sequência de implementação

```
1. Migrar packages/infra-turbo-cache → packages/infra-cloudflare
   src/index.ts + wrangler.toml movem para
   packages/infra-cloudflare/src/services/turbo-cache/worker/

2. Escrever packages/infra-cloudflare/src/provider.ts
   CloudflareProvider usando execFileNoThrow (não exec)

3. Escrever provision.ts + manifest.ts do turbo-cache

4. Escrever apps/refarm/src/commands/provision.ts

5. Registrar provision no program.ts do CLI

6. Escrever testes do provisioner com --dry-run
```

## Fora do escopo desta feature

- Suporte a outros provedores (AWS, Vercel) — a interface foi desenhada para recebê-los
- Remoção de recursos (`refarm deprovision`)
- Automação de `gh secret set` — o comando imprime os valores; automação é iteração seguinte

## Critérios de aceitação

- `refarm provision cloudflare turbo-cache` completa sem erro em conta Cloudflare limpa
- Rodar duas vezes é idempotente (sem erro "already exists")
- `--dry-run` não cria nenhum recurso e imprime o plano
- Nenhum segredo é passado via argumento de linha de comando (apenas via stdin ou env)
- URL e token gerado são impressos de forma copiável para o CI
