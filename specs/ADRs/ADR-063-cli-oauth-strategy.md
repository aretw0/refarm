# ADR-063 — Estratégia de autenticação OAuth para a CLI

**Status:** Accepted  
**Date:** 2026-05-11  
**Author:** Arthur Silva  
**Related:** ADR-034 (identity adoption), ADR-062 (Cloudflare provider)

## Context

O `refarm sow` precisa coletar credenciais de providers externos (GitHub, Cloudflare, futuros) de forma que funcione para qualquer pessoa que instale a CLI — sem criar OAuth Apps próprios, sem copiar tokens do navegador manualmente, sem atritos de onboarding.

Existem dois flows OAuth distintos que frequentemente se confundem:

| Flow | Casos de uso | Precisa de servidor? |
|---|---|---|
| **Authorization Code** | Web apps com redirect | Sim — recebe o callback |
| **Device Authorization Grant** (RFC 8628) | CLIs, dispositivos sem browser | Não |

A CLI é um cliente sem servidor. O Device Flow é o mecanismo correto.

## Decisão

**A CLI usa exclusivamente Device Authorization Grant (RFC 8628) para providers que o suportam.**

### O que isso significa na prática

**1. O campo "Authorization callback URL" no GitHub OAuth App é `http://localhost` para sempre.**

Esse campo é obrigatório no formulário do GitHub, mas nunca é chamado no device flow. Toda CLI do ecossistema usa `http://localhost` como placeholder canônico — `gh`, `copilot-cli`, `azure-cli`. Não é uma solução provisória à espera de um servidor real: é o design correto para o caso de uso CLI.

**2. Cada domínio web do projeto é um OAuth App separado, com callback URL real, quando e porque tiver um servidor 24h.**

| Propriedade | Quando precisará de callback real | Scopes prováveis |
|---|---|---|
| `refarm.dev` | Quando tiver "Sign in" no portal / docs | `read:user user:email` |
| `refarm.me` | Quando o usuário tiver instância pessoal com auth web | `read:user user:email` |
| `refarm.social` | Quando tiver funcionalidade social com login | `read:user user:email` |
| CLI (`refarm sow`) | Nunca — device flow não usa callback | `repo read:org` |

Os domínios `.me` e `.social` são instâncias por usuário — o callback URL seria `https://<usuario>.refarm.me/auth/callback`. Quando isso existir, cada instância registra seu próprio OAuth App, ou o projeto oferece um OAuth App hospedado centralizado em `refarm.dev` que redireciona para a instância correta.

**3. O `client_id` do OAuth App da CLI é configurável por distro.**

O default (`Ov23lier7kyBcgIUQsih`) é o app registrado na conta pessoal do mantenedor atual. Quando o projeto migrar para a org `refarm-dev`, atualiza-se `DEFAULT_CLIENT_ID` em `src/credentials/github.ts` — uma linha.

Quem constrói uma distro focada sobre os blocos do refarm pode sobrescrever em `refarm.config.json`:

```json
{ "providers": { "github": { "clientId": "SeuClientId" } } }
```

Ou via env: `REFARM_PROVIDER_GITHUB_CLIENT_ID=SeuClientId`.

O `client_id` não é segredo — o device flow não usa `client_secret`. É seguro commitar.

**4. Providers sem device flow usam paste com tail masking.**

Cloudflare não implementa device flow. O fluxo é: mostrar URL de geração do token, tentar abrir o browser, pedir o valor via prompt com os últimos 4 caracteres visíveis (padrão Claude Code / `gh`).

### Interface extensível

```typescript
// src/credentials/types.ts
export interface CredentialProvider {
  readonly id: string;
  readonly label: string;
  collect(ctx: CollectContext): Promise<string>;
}
```

Adicionar um novo provider é um arquivo em `src/credentials/` + uma linha em `sow.ts`. O mecanismo interno (device flow, paste, browser OAuth) é detalhe de implementação do provider.

## Alternativas consideradas

**Authorization Code + servidor local** — abrir um servidor HTTP efêmero em `localhost:PORT` para receber o callback. Funciona, mas exige porta disponível, firewall rules em alguns ambientes corporativos, e é mais complexo de implementar e debugar. O device flow é mais simples e mais robusto para CLI.

**PAT manual sem guidance** — pedir o token sem abrir o browser ou mostrar a URL. Funcionava antes, mas cria atrito desnecessário e não escala para onboarding de novos usuários.

## Consequências

- Qualquer pessoa que instala `refarm` autentica com GitHub via device flow, sem configuração adicional, identicamente ao `gh auth login`.
- A migração da conta pessoal para a org `refarm-dev` é uma linha de código.
- Web apps dos domínios `.dev`, `.me`, `.social` terão seus próprios OAuth Apps quando existirem, com scopes e callbacks apropriados — sem conflito com a CLI.
- O campo callback URL do OAuth App da CLI nunca precisará de um servidor real.
