# @refarm.dev/release-engine

> Nota arquitetônica: este pacote é deliberadamente genérico. A política concreta de cada repositório fica no próprio `releasePolicy` da configuração estratégica (p.ex. `refarm.config.json` no host).

Solução de propósito geral para **planejamento e policy de release** de projetos.

Objetivo: materializar decisão de release como **política declarativa + grafo de gates**, sem fixar escolha de projeto no pacote. Cada repositório declara sua própria política via `releasePolicy` (por padrão em `refarm.config.json`, com `.refarm/config.json` mantido como legado) e pode sobrescrever via `--policy` em cenários explícitos. Projetos como `refarm`, `vault-seed`, `agents-lab` podem compartilhar o mesmo engine e manter política própria.

## O que está aqui

- Leitura de política de release (fonte padrão: `refarm.config.json` no projeto, com fallback legado)
- Descoberta de candidatos via `changeset` ou lista explícita
- Ordenação topológica por dependência entre pacotes
- Geração de plano (status, bloqueadores, ordem, perfis/tags de pacote)
- Sumário de aceitação (`acceptance`) para consumidores decidirem handoff/publicação sem reinterpretar o plano inteiro
- Execução padronizada de gates de qualidade/release
- API pública para hosts como `refarm release`
- JSON Schema importável em `@refarm.dev/release-engine/release-policy.schema.json`
- JSON Schema importável em `@refarm.dev/release-engine/release-output.schema.json`
- CLI local minimal para smoke do próprio pacote (`node packages/release-engine/src/cli.mjs`): `plan`, `check`, `gates`

## Arquitetura inicial

- **Policy-first**: a política define fases, provedores e perfis de pacote.
- **Provider-agnostic**: o contrato de provider é extensível.
- **Changeset-aware**: sem mudançasets, o plano cai para fallback conservador.
- **Não é um fluxo “publish instantâneo”**: o pacote prepara o plano e verifica ordem/gates; publicação final permanece sob controle do CI.

## Contrato de provider e CI

O provider é uma declaração de capacidade, não um adaptador carregado por nome.
Nesta fase, `release-engine` usa o provider para decidir intenção de publicação e
comandos de dry-run; o host/CI continua responsável por permissões, secrets e
execução final.

Campos mínimos:

- `id`: identificador estável usado em `providers` do plano.
- `type`: família operacional (`changesets`, `legacy-tag`, `npm`, `github-release`, etc.).
- `supportsPublish`: se o provider participa de `publishIntents`.
- `supportsDryRun`: se o provider declara comandos de validação sem publicação.
- `publishCommands`: obrigatório quando `supportsPublish: true`.
- `publishDryRunCommands`: opcional; se ausente, herda `publishCommands`.
- `publishRequiresManualApproval`: opcional; quando ausente, `changeset` assume aprovação manual.

Providers inativos são válidos: `supportsPublish: false` não gera
`publishIntents`. Uma lista vazia de providers também é aceita como contrato
neutro para consumidores que ainda só querem plano/gates.

Códigos de erro estruturados de provider expostos por
`ReleasePolicyValidationError`:

- `RELEASE_POLICY_PROVIDER_ID_REQUIRED`
- `RELEASE_POLICY_PROVIDER_DUPLICATE_ID`
- `RELEASE_POLICY_PROVIDER_TYPE_INVALID`
- `RELEASE_POLICY_PROVIDER_SUPPORTS_PUBLISH_INVALID`
- `RELEASE_POLICY_PROVIDER_SUPPORTS_DRY_RUN_INVALID`
- `RELEASE_POLICY_PROVIDER_COMMANDS_INVALID`
- `RELEASE_POLICY_PROVIDER_DRY_RUN_COMMANDS_INVALID`
- `RELEASE_POLICY_PROVIDER_PUBLISH_COMMANDS_REQUIRED`

Integração CI recomendada:

1. Rodar `refarm release plan --selection default --json` para materializar a ordem.
2. Rodar `refarm release check --selection default --dry-run --json` antes de tocar secrets.
3. Validar `schemaVersion` contra `release-output.schema.json`.
4. Executar publicação apenas no workflow/host que possui credenciais e aprovação.

O pacote não deve acessar `NPM_TOKEN`, GitHub Releases, crates.io ou canais. Esses
adaptadores pertencem ao host/control-plane consumidor, como workflows ou uma
aplicação de operador, e consomem a saída versionada do engine.

O exemplo canônico de provider changesets fica em
`examples/release-provider-changesets`. Ele é um pacote-modelo privado para
copiar/adaptar a declaração de provider e um helper de policy; não altera o
engine principal nem executa publicação.

## Uso sem publicar (fase local)

- O pacote foi criado para ser testado em outros projetos antes de publicação do npm:
  - mantenha o projeto consumidor com a dependência apontando para a fonte local do fornecedor do engine (ex.: `workspace:*` em monorepo, ou `link:`/`file:` durante calibração),
  - declare `releasePolicy` em `refarm.config.json`,
  - importe a API pública por package name (`@refarm.dev/release-engine`) ou use `refarm release` como control-plane.

- `.refarm/config.json` e `release-policy.json` continuam suportados para compatibilidade e scripts legados. Um `release-policy.json` explícito preserva precedência quando existir.

O `src/cli.mjs` é mantido para smoke local do pacote. Não o trate como entrypoint estável para consumidores; o entrypoint operacional é `refarm release`.

## Uso rápido

```bash
# plano operacional via host CLI (usa refarm.config.json por padrão)
refarm release plan --json

# plano por seleção declarada na política
refarm release plan --selection default --json

# plano com registro auditável e digest SHA-256
refarm release plan --selection default --json --audit

# validar candidatos explícitos (sem changesets)
refarm release plan @scope/pkg-name

# listar candidatos por postura declarada na política
refarm release plan --tag kernel-contract --json

# rodar gates em dry-run (sem executar comandos)
refarm release check --selection default --dry-run

# quando não houver política no projeto, usa defaults neutros (não executivos)
refarm release plan --json --policy não-existe.json
```

O payload JSON de `plan` inclui `packageProfiles` para os pacotes selecionados,
derivado da política ativa. Isso permite que um control plane diferencie
`kernel-contract`, `kernel-primitive`, `reference-hold`, `internal-lab` ou outras
tags de postura sem acoplar essas categorias ao engine.
O mesmo payload inclui `acceptance`, um resumo append-only de aceitação com
status (`accepted`/`blocked`), contagens de blockers, gates obrigatórios,
checks obrigatórios por pacote, providers, aprovação manual e superfícies
envolvidas. Consumidores como um CLI de produto podem usar esse campo para
decidir se um pacote candidato está pronto para handoff/publicação sem depender
de nomes internos do host.
Todo payload JSON emitido pelo CLI do pacote carrega `schemaVersion: 1`; campos
novos devem ser adicionados de forma compatível. Consumidores de máquina devem
falhar fechado quando receberem uma versão maior que a suportada.
O contrato de saída também vale para planos bloqueados: `plan` sempre emite
`publishIntents`, e `check`/`gates` sempre emitem `gateResult.results`,
`gateResult.policy` e `gateResult.dryRun`, mesmo quando a execução para antes
dos gates.

`--tag` pode ser repetido e usa filtro AND: `--tag kernel --tag candidate`
seleciona apenas perfis que tenham ambas as tags. Prefira `--selection <id>`
para comandos diários: `--selection default` resolve
`releasePolicy.defaultSelection`. Uma seleção explícita inexistente falha cedo,
para evitar que erro de configuração vire plano por changesets acidentalmente.

Consumidores que validam configuração antes de chamar o engine podem carregar o
schema publicado em
`@refarm.dev/release-engine/release-policy.schema.json`.

Para logs/auditoria, a API pública expõe `createReleasePlanAuditRecord(plan)`.
Ela normaliza a parte relevante do plano e anexa um digest SHA-256 estável do
payload canônico, permitindo comparar ou arquivar a decisão sem depender da
ordem de propriedades do JSON. O CLI também aceita `--audit` junto de `--json`
para anexar esse record como `auditRecord`.
Consumidores que validam a saída do CLI podem carregar
`@refarm.dev/release-engine/release-output.schema.json`.

## Invariantes de policy

`validatePolicy` rejeita configuração ambígua antes de montar plano:

- `policyVersion` deve estar em `SUPPORTED_POLICY_VERSIONS` (atualmente `2026-01`).
- `providers` e `packageProfiles` devem usar IDs únicos.
- providers com `supportsPublish: true` devem declarar `publishCommands` não vazios.
- `defaultSelection`, quando declarado, deve apontar para uma entrada de `selections`.
- cada seleção deve declarar `profileTags` com pelo menos uma tag não vazia.
- `packageProfiles[].risk`, `packageProfiles[].surface` e
  `packageProfiles[].bump`, quando declarados, devem usar os enums do schema.
- `surfaceBlocks[]` bloqueia explicitamente superfícies de release (`core`,
  `app`, `plugin`, `agent`, `shared`) com motivo auditável antes dos gates.

Quando a versão da policy é maior/desconhecida, `validatePolicy` falha fechado
com `ReleasePolicyValidationError.code =
RELEASE_POLICY_VERSION_UNSUPPORTED`. Consumidores devem tratar esse erro como
pedido de upgrade do engine ou migração explícita da policy.

## Changelog e semver

O pacote mantém `CHANGELOG.md` versionado mesmo antes da publicação. A linha
`0.1.0-dev` representa o contrato pretendido para o primeiro release público.
Depois da publicação, remoções ou mudanças incompatíveis em exports, schemas,
`schemaVersion`, `policyVersion`, códigos de erro ou formato JSON exigem major;
campos opcionais/aditivos ficam em minor ou patch conforme risco.
As superfícies críticas e a regra append-only estão listadas em `CONTRACTS.md`,
que também é incluído no pacote publicado.

## Convergência futura (já pensada)

- Adaptadores de **PublishTarget** para npm, GitHub Release, crates.io, etc.
- Adaptadores de **RuntimeGateProvider** por domínio (CI, local, observabilidade).
- Exportar API de plano como artefato para auditoria humana.
- Integração com outros projetos via `@refarm.dev/release-engine` como pacote publicado ou dependência local durante calibração.

### Arquitetura de controle operacional

- O `release-engine` permanece neutro; não conhece Telegram/Matrix/Cascade ou outro canal.
- Um host/control-plane consumidor escolhe quais repositórios/políticas executar
  e invoca a API pública do pacote.
- `refarm release plan --cwd <repo> --selection default --json` é a superfície operacional inicial para aplicar a mesma política em outros workspaces sem acoplar o engine a um produto.
- A integração em qualquer host, incluindo `apps/refarm`, deve ser não
  bloqueante: se a seleção externa falhar, o host reporta blockers e
  `nextCommands`; não transforma ausência de policy downstream em publish local.
- Dessa forma, a integração de canais futuros fica concentrada no host/entrada (bot/adaptador), mantendo o pacote reutilizável.

## Próximos passos

- Exportar API de telemetria para rastreabilidade de decisão
- Incluir providers de publicação reais com assinatura/attestation
