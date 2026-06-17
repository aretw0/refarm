# Release Engine (Refarm Convergent Policy)

Este documento descreve como o Refarm está consolidando seu fluxo de release em um motor reutilizável, mantendo o motor com defaults neutros.

## Princípios

1. **Policy-first**: toda decisão de ordem/publicação é resultado de um contrato, não de código.
2. **Provider-agnóstico**: o motor descreve *o que* precisa ser verificado/publicado; adaptadores concretos ficam em providers por projeto.
3. **Ordem determinística**: dependências entre pacotes são respeitadas automaticamente.
4. **Gates explícitos**: qualidade, runtime e conformidade ficam em fases com falha clara.

## Estado atual

O primeiro motor foi introduzido em `packages/release-engine` e o Refarm já declara sua política de release em `.refarm/config.json` (`releasePolicy`).

Esta camada de engine não embute política do Refarm; ela só fornece defaults neutros. As escolhas de gate, ordem e publicação ficam declaradas no bloco `releasePolicy` (ou políticas por projeto).

## Como usar hoje (sem publicar)

- `release-engine` é **testável por projeto sem publish**: basta que o projeto dependa do pacote local (ou instalado) e carregue `releasePolicy` em `.refarm/config.json`.
- O fallback para `release-policy.json` continua para compatibilidade e cenários explícitos.
- No limite, um projeto consumidor pode executar:
  - `node <caminho>/packages/release-engine/src/cli.mjs plan --json --only-required`
  - `node <caminho>/packages/release-engine/src/cli.mjs check --only-required --json`
- Isso mantém a integração de projetos (`refarm`, `vault-seed`, `agents-lab`) independente do fato de o pacote estar ou não publicado.

Comandos disponíveis:

- `node scripts/release-engine.mjs plan --only-required --dry-run --json` (pré-flight)
- `pnpm release-engine:plan` → plano + status (usa `.refarm/config.json` por padrão)
- `pnpm release-engine:check` → plano + dry-run de gates
- `pnpm release-engine:gates` → execução de gates (`--dry-run` disponível)
- `pnpm release-engine:orchestrate --repo . --repo ../vault-seed check --only-required --json` → roda `release-engine` em vários repositórios em um único comando.
- `pnpm release-engine:orchestrate --repo-manifest ./docs/release-workspaces.example.json check --json` → usa um manifesto compartilhado por plataforma/projeto.
- `pnpm release-engine:orchestrate --repo-manifest ./docs/release-workspaces.example.json --policy ./policies/global-release-policy.json check --only-required --json` → política global padrão para entradas sem `policy` local.
- `pnpm release-engine:orchestrate --engine-cli ./path/ao/cli.js check` → substitui o entrypoint do engine para cenários de teste/integração.
- `--policy <arquivo>` ainda pode ser usado para sobrepor explicitamente a fonte de política para entradas sem override local.

Exemplo de manifesto simples (`release-workspaces.json`):

```json
{
  "repos": [
    { "label": "refarm", "path": ".", "args": ["--json"] },
    { "label": "vault-seed", "path": "../vault-seed", "policy": "release-policy.json", "args": ["--only-required", "--json"] },
    { "label": "agents-lab", "path": "../agents-lab", "args": ["--only-required", "--json"] }
  ]
}
```

A intenção aqui é manter `release-engine` neutro e permitir que o seu control-plane de projetos (ou um futuro bot/canal) escolha qual política e quais repositórios executar, sem que a engine saiba de chat, Telegram, Matrix, etc.

## Critérios para a 1ª minor (sem entrar cedo em breaking)

- `node --test packages/release-engine/test/release-engine.test.mjs`
- `node scripts/release-engine.mjs plan --only-required --json`
- `node scripts/release-engine.mjs check --only-required --json`
- `node --test scripts/ci/test-smoke-refarm-host-cli-flows.mjs`
- `git diff` limpo e saída de `check` não precisa bloquear fluxos legados em execução já existente.
- `releasePolicy` no `refarm` validado em `.refarm/config.json` (fallback neutro confirmado).

## Próximo movimento de convergência

- Consolidar providers reais para `refarm`, `vault-seed`, `agents-lab` via o mesmo contrato de política sem duplicar scripts de fluxo.
- Publicar somente a API de política/gating do `release-engine` quando estabilidade da suíte de testes e integrações de projeto estabilizar.
- Integrar o contrato `@refarm.dev/dispatch-surface` ao policy de publicação: releases de pacotes/ambientes que alteram a superfície de dispatch devem rodar `dispatch-surface:build-rs:release` em modo estrito, conforme já ligado em `.github/workflows/release-changesets.yml`, `.github/workflows/publish-packages.yml`, e `.github/workflows/publish-crates.yml`.
- A detecção de impacto desta cláusula está centralizada em `scripts/ci/release-dispatch-surface-build.sh` para evitar divergência entre workflows de publicação (inclusive `.github/workflows/test.yml`, usando `--check`).
