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

## Como usar hoje

- `@refarm.dev/release-engine` é a **primitiva/SDK**: projetos consumidores dependem do pacote e importam a API pública por package name.
- `refarm release` é a **superfície operacional**: operadores e handoffs usam a CLI do Refarm, não caminhos internos do pacote.
- O fallback para `release-policy.json` continua para compatibilidade e cenários explícitos.
- `--selection <id>` seleciona grupos declarados em `releasePolicy.selections`; `--selection default` resolve `releasePolicy.defaultSelection`.
- Seleção explícita que não existe falha cedo. Isso evita que erro de política vire plano baseado em changesets por acidente.
- A policy runtime também valida invariantes estruturais: providers e perfis de pacote não podem ter IDs duplicados, providers publicadores precisam declarar `publishCommands`, `defaultSelection` precisa apontar para uma seleção declarada, toda seleção precisa declarar `profileTags` não vazias e `risk`/`bump` seguem os enums do schema.

Comandos operacionais:

- `refarm release plan --selection default --json` → plano declarado para a seleção padrão do workspace.
- `refarm release plan --tag kernel-contract --json` → plano por tags de perfil, útil para auditoria.
- `refarm release check --selection default --dry-run --json` → plano + dry-run dos gates.
- `refarm release gates --selection default --dry-run --only-required --json` → valida somente gates obrigatórios em dry-run.
- `refarm release plan --cwd ../vault-seed --selection default --json` → usa o Refarm como control-plane para outro workspace com política própria.
- `--policy <arquivo>` ainda pode ser usado para sobrepor explicitamente a fonte de política.

Readiness de primeira release:

- `pnpm run release:readiness:plan` → mostra a sequência de gates que responde "estamos prontos para publicar?" sem executar nada.
- `pnpm run release:readiness` → executa o corte local de readiness para npm/crates/workflows usando gates existentes.
- `pnpm run release:policy:check` → valida só a política declarada e os gates obrigatórios em dry-run.

Essa camada não substitui o `release-engine`: ela é um orquestrador de repo que
amarra saúde do operador, política de release, substratos Node/Rust, ownership de
artefatos, contratos de GitHub Actions e dry-run de publicação em uma pergunta
única.

Uso como SDK:

```js
import {
  buildReleasePlan,
  runReleaseGates,
  summarizePlan,
} from "@refarm.dev/release-engine";

const plan = buildReleasePlan({
  cwd: process.cwd(),
  selectionId: "default",
});

console.log(summarizePlan(plan));
runReleaseGates(plan, { dryRun: true, onlyRequired: true });
```

A intenção aqui é manter `release-engine` neutro e permitir que o control-plane de projetos (ou um futuro bot/canal) escolha qual política e quais repositórios executar, sem que a engine saiba de chat, Telegram, Matrix, etc.

## Critérios para a 1ª minor (sem entrar cedo em breaking)

- `node --test packages/release-engine/test/release-engine.test.mjs`
- `refarm release plan --selection default --json`
- `refarm release check --selection default --dry-run --json`
- `node --test scripts/ci/test-smoke-refarm-host-cli-flows.mjs`
- `git diff` limpo e saída de `check` não precisa bloquear fluxos legados em execução já existente.
- `releasePolicy` no `refarm` validado em `.refarm/config.json` (fallback neutro confirmado).

## Próximo movimento de convergência

- Consolidar providers reais para `refarm`, `vault-seed`, `agents-lab` via o mesmo contrato de política sem duplicar scripts de fluxo.
- Publicar somente a API de política/gating do `release-engine` quando estabilidade da suíte de testes e integrações de projeto estabilizar.
- Integrar o contrato `@refarm.dev/dispatch-surface` ao policy de publicação: releases de pacotes/ambientes que alteram a superfície de dispatch devem rodar `dispatch-surface:build-rs:release` em modo estrito, conforme já ligado em `.github/workflows/release-changesets.yml`, `.github/workflows/publish-packages.yml`, e `.github/workflows/publish-crates.yml`.
- A detecção de impacto desta cláusula está centralizada em `scripts/ci/release-dispatch-surface-build.sh` para evitar divergência entre workflows de publicação (inclusive `.github/workflows/test.yml`, usando `--check`).
