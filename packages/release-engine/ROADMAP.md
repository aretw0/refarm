# Release Engine (v0.0.1-dev) - Roadmap

**Current Version**: 0.0.1-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)

Este pacote é a primeira abstração consolidada da política de release do Refarm como produto reutilizável.

> Contexto atual: o pacote ainda **não foi publicado**. Neste ciclo, a prioridade é preparar um **primeiro release com qualidade de minor madura**, reduzindo risco de mudanças de breaking logo após lançar.

## V0 — Núcleo de Planejamento Determinístico

**Objetivo:** introduzir o núcleo mínimo de policy/ordenação/gates sem acoplar providers.

### SDD (Spec Driven)
- [x] Definir contrato mínimo de policy para release.
- [x] Definir estrutura de fases e perfil de checks.
- [x] Definir política de descoberta de candidatos (changeset + seleção explícita).

### BDD (Behaviour Driven)
- [x] `plan` descreve blockers e ordem recomendada.
- [x] `check` executa validação de plano + dry-run de gates.
- [x] `gates` roda fases de publicação sem alterar estado.

### TDD (Test Driven)
- [x] Testes unitários de parsing de policy.
- [x] Testes de ordenação topológica de dependências.
- [ ] Testes de integração com policy por projeto (refarm/vault-seed/agents-lab).

### DDD (Domain Delivery)
- [x] CLI e API em módulo próprio (`packages/release-engine`).
- [x] Política padrão embutida via `.refarm/config.json` com fallback seguro.
- [x] Compatibilidade de leitura com `release-policy.json` (override explícito) preservada.
- [ ] Documentar contratos de provider e integração em CI.
- [ ] Publicar o pacote como `@refarm.dev/release-engine` quando cobertura de uso estabilizar.

## V0.x — Composição segura pré-publicação

**Objetivo:** dar base para uso por outros projetos, com qualidade suficiente para chegar ao primeiro minor de forma saudável.

### SDD (Spec Driven)
- [ ] Definir contrato formal de provider (interface mínima, campos obrigatórios/ opcionais, códigos de erro estruturados).
- [ ] Definir política de compatibilidade por versão do `release-policy` (incluindo fallback defensivo para mudanças no schema).
- [ ] Especificar formato de saída de `plan`/`check` estável para consumidores de máquina.

### BDD (Behaviour Driven)
- [ ] Registrar cenário de fallback: política local ausente usa default neutro, sem mudar side-effects.
- [ ] Registrar cenários com `--policy` explícito preservando comportamento atual.
- [ ] Registrar cenários de provider opcional: planos podem ter providers inativos/ausentes sem bloquear parsing.

### TDD (Test Driven)
- [ ] Testes de contrato para compatibilidade com config embutida + arquivo legado.
- [ ] Teste de “non-breaking migration”: política antiga carregada continua válida.
- [ ] Testes de contrato JSON Schema para retorno de `plan`/`check` (campos estáveis, sem surpresa).

### DDD (Domain Delivery)
- [ ] Documentar integração de providers com `apps/refarm` (controle de release por vault) em modo não bloqueante.
- [ ] Adicionar `CHANGELOG` inicial (`0.0.1-dev` → `0.0.z`) com disciplina de semver.
- [ ] Definir pacote de exemplo `release-provider` canônico (changesets) sem alterar engine principal.
- [ ] Adotar o padrão “adição por append, sem remoção” nos contratos críticos.
- [ ] Publicar **primeiro minor** com base em critérios objetivos de estabilidade funcional e integração (não por pressa).

## V1 — Engine de Convergência (pós-primeira minor)

**Objetivo:** suportar vários ecossistemas de publicação e prover plano auditável.

- [ ] Provider plugin model para `npm`, `github-release`, `pypi` etc.
- [ ] Output imutável de plano para logs/audit.
- [ ] Integração com `refarm`, `vault-seed`, `agents-lab` via policy local.
- [ ] Bloqueios explícitos por superfície (`core`, `app`, `plugin`, `agent`).

## V2 — Release-as-a-Service do ecossistema

**Objetivo:** engine virar base para publicação orquestrada entre projetos.

- [ ] Composição com `toolbox` para comandos de operador.
- [ ] Publicação de política e plano com evidência hash.
- [ ] Métricas de conformidade de release por projeto.
