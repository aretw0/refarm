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
- `--policy <arquivo>` ainda pode ser usado para sobrepor explicitamente a fonte de política

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
