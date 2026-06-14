# @refarm.dev/release-engine

> Nota arquitetônica: este pacote é deliberadamente genérico. A política concreta de cada repositório fica no próprio `releasePolicy` da configuração estratégica (p.ex. `.refarm/config.json` no Refarm).

Solução de propósito geral para **planejamento e policy de release** de projetos.

Objetivo: materializar decisão de release como **política declarativa + grafo de gates**, sem fixar escolha de projeto no pacote. Cada repositório declara sua própria política via `releasePolicy` (por padrão em `.refarm/config.json`) e pode sobrescrever via `--policy` em cenários explícitos. Projetos como `refarm`, `vault-seed`, `agents-lab` podem compartilhar o mesmo engine e manter política própria.

## O que está aqui

- Leitura de política de release (fonte padrão: `.refarm/config.json` no projeto)
- Descoberta de candidatos via `changeset` ou lista explícita
- Ordenação topológica por dependência entre pacotes
- Geração de plano (status, bloqueadores, ordem)
- Execução padronizada de gates de qualidade/release
- CLI minimal (`release-engine`): `plan`, `check`, `gates`

## Arquitetura inicial

- **Policy-first**: a política define fases, provedores e perfis de pacote.
- **Provider-agnostic**: o contrato de provider é extensível.
- **Changeset-aware**: sem mudançasets, o plano cai para fallback conservador.
- **Não é um fluxo “publish instantâneo”**: o pacote prepara o plano e verifica ordem/gates; publicação final permanece sob controle do CI.

## Uso sem publicar (fase local)

- O pacote foi criado para ser testado em outros projetos antes de publicação do npm:
  - mantenha o projeto consumidor com a dependência apontando para a fonte local do repositório Refarm (ex.: `workspace:*` em monorepo, ou `link:`/`file:` durante calibração),
  - declare `releasePolicy` em `.refarm/config.json`,
  - execute o CLI com `node <repo>/packages/release-engine/src/cli.mjs ...`.

- `release-policy.json` continua suportado para compatibilidade e scripts legados.

## Uso rápido

```bash
# plano a partir de changesets pendentes (usa .refarm/config.json por padrão)
node packages/release-engine/src/cli.mjs plan --json

# validar candidatos explícitos (sem changesets)
node packages/release-engine/src/cli.mjs plan @scope/pkg-name

# rodar gates em dry-run (sem executar comandos)
node packages/release-engine/src/cli.mjs check --dry-run

# quando não houver política no projeto, usa defaults neutros (não executivos)
node packages/release-engine/src/cli.mjs plan --json --policy não-existe.json
```

## Convergência futura (já pensada)

- Adaptadores de **PublishTarget** para npm, GitHub Release, crates.io, etc.
- Adaptadores de **RuntimeGateProvider** por domínio (CI, local, observabilidade).
- Exportar API de plano como artefato para auditoria humana.
- Integração com outros projetos via `packages/release-engine` como submódulo/pacote publicado.

### Arquitetura de controle operacional

- O `release-engine` permanece neutro; não conhece Telegram/Matrix/Cascade ou outro canal.
- Um control-plane host (ex.: `apps/refarm`) escolhe quais repositórios/políticas executar e invoca o CLI por repositório.
- Um orquestrador interno (`scripts/release-engine-orchestrator.mjs`) já existe para esse papel e pode ser alimentado por manifesto (`--repo-manifest`) sem acoplar a engine a um produto.
- O manifesto pode carregar `args` e `policy` por repositório (`--policy` local por entrada), permitindo que um único control-plane invoque projetos heterogêneos com contratos diferentes sem tocar no engine.
- Dessa forma, a integração de canais futuros fica concentrada no host/entrada (bot/adaptador), mantendo o pacote reutilizável.

## Próximos passos

- Cobrir contratos JSON Schema (incluindo validadores de runtime)
- Exportar API de telemetria para rastreabilidade de decisão
- Incluir providers de publicação reais com assinatura/attestation
