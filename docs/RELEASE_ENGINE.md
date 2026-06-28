# Release Engine (Refarm Convergent Policy)

Este documento descreve como o Refarm está consolidando seu fluxo de release em um motor reutilizável, mantendo o motor com defaults neutros.

## Princípios

1. **Policy-first**: toda decisão de ordem/publicação é resultado de um contrato, não de código.
2. **Provider-agnóstico**: o motor descreve *o que* precisa ser verificado/publicado; adaptadores concretos ficam em providers por projeto.
3. **Ordem determinística**: dependências entre pacotes são respeitadas automaticamente.
4. **Gates explícitos**: qualidade, runtime e conformidade ficam em fases com falha clara.

## Estado atual

O primeiro motor foi introduzido em `packages/release-engine` e o Refarm já declara sua política de release em `refarm.config.json` (`releasePolicy`). `.refarm/config.json` continua sendo lido como legado local quando não há configuração versionada.

Esta camada de engine não embute política do Refarm; ela só fornece defaults neutros. As escolhas de gate, ordem e publicação ficam declaradas no bloco `releasePolicy` (ou políticas por projeto).

Compatibilidade de policy é defensiva: o runtime só aceita versões em
`SUPPORTED_POLICY_VERSIONS` (hoje `2026-01`). Versão maior ou desconhecida falha
fechado com `RELEASE_POLICY_VERSION_UNSUPPORTED`, para evitar interpretar uma
policy futura com semântica antiga.

## Como usar hoje

- `@refarm.dev/release-engine` é a **primitiva/SDK**: projetos consumidores dependem do pacote e importam a API pública por package name.
- `refarm release` é a **superfície operacional**: operadores e handoffs usam a CLI do Refarm, não caminhos internos do pacote.
- O fallback para `release-policy.json` continua para compatibilidade e cenários explícitos.
- `--selection <id>` seleciona grupos declarados em `releasePolicy.selections`; `--selection default` resolve `releasePolicy.defaultSelection`.
- Seleção explícita que não existe falha cedo. Isso evita que erro de política vire plano baseado em changesets por acidente.
- A policy runtime também valida invariantes estruturais: providers e perfis de pacote não podem ter IDs duplicados, providers publicadores precisam declarar `publishCommands`, `defaultSelection` precisa apontar para uma seleção declarada, toda seleção precisa declarar `profileTags` não vazias e `risk`/`bump` seguem os enums do schema.

## Contrato de provider/CI

Provider no `release-engine` é uma declaração de intenção, não um plugin com
credenciais. O pacote gera `publishIntents` e gates; o host/CI decide se pode
executar publicação real.

- `supportsPublish: true` exige `publishCommands`.
- `publishDryRunCommands` descreve a validação sem publicar; se ausente, herda
  `publishCommands`.
- `publishRequiresManualApproval` permite que o host mostre uma barreira humana.
- `supportsPublish: false` permite providers de contexto ou legado sem bloquear
  parsing.
- `providers: []` é aceito como contrato neutro quando o consumidor ainda não
  declarou publicação real.
- Erros de provider saem como `ReleasePolicyValidationError` com `code` estável
  e `details.providerId` quando aplicável.

Fluxo CI recomendado:

1. `refarm release plan --selection default --json`
2. Validar `schemaVersion: 1` com `@refarm.dev/release-engine/release-output.schema.json`.
3. `refarm release check --selection default --dry-run --json`
4. Só o workflow que possui secrets executa comandos de publicação.

`apps/refarm` integra isso como control-plane não bloqueante: para workspaces
externos, ausência de policy ou seleção inválida vira blocker/nextCommand, não
tentativa implícita de publicar pelo Refarm atual.

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
- `pnpm run reference-driver:smoke` → prova leve, sem provider, do SDK
  `worker-profile` e das primitivas `runtime-agent`/reference-driver que
  precisam continuar funcionando antes de empacotar SDKs ou runtime de
  publicação.

Evidência local mais recente (2026-06-27): `pnpm run release:readiness`
passou fim a fim para a seleção padrão `kernel-candidates`. O dry-run de
publicação cobriu `@refarm.dev/storage-contract-v1`, `@refarm.dev/sync-contract-v1`,
`@refarm.dev/identity-contract-v1` e `@refarm.dev/channel-policy-v1`. Esse
resultado prova readiness local; não substitui aprovação explícita de publicação
nem credenciais de npm/crates.

Evidência de plano mais recente (2026-06-28): `pnpm run release:readiness:test`
prova que `reference-driver:smoke` está no plano antes do dry-run de publicação,
e que o próprio smoke começa pelo contrato plan-only de workers antes das
primitivas de sessão/tree/code-ops do `runtime-agent`. Isso mantém o corte de
readiness sem provider real e sem obrigar um smoke Rust completo em cada
micro-slice.

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
- `releasePolicy` no `refarm` validado em `refarm.config.json` (fallback neutro confirmado).
- Payloads bloqueados também preservam o contrato JSON: `plan` inclui
  `publishIntents: []`, e `check`/`gates` incluem `gateResult.results`,
  `gateResult.policy` e `gateResult.dryRun`.

## Próximo movimento de convergência

- Consolidar providers reais para `refarm`, `vault-seed`, `agents-lab` via o mesmo contrato de política sem duplicar scripts de fluxo, apenas depois de cada consumidor ter policy própria.
- Publicar somente a API de política/gating do `release-engine` quando estabilidade da suíte de testes e integrações de projeto estabilizar.
- Integrar o contrato `@refarm.dev/dispatch-surface` ao policy de publicação: releases de pacotes/ambientes que alteram a superfície de dispatch devem rodar `dispatch-surface:build-rs:release` em modo estrito, conforme já ligado em `.github/workflows/release-changesets.yml`, `.github/workflows/publish-packages.yml`, e `.github/workflows/publish-crates.yml`.
- A detecção de impacto desta cláusula está centralizada em `scripts/ci/release-dispatch-surface-build.sh` para evitar divergência entre workflows de publicação (inclusive `.github/workflows/test.yml`, usando `--check`).
