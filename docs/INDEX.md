# Refarm Documentation

**Status**: Active Development  
**Last Updated**: 2026-03-04

---

## 🗺 Knowledge Map (Architecture of Truth)

### 🏛 Philosophy & Vision
- **[Architecture](ARCHITECTURE.md)** - System design, Evolutionary Roadmap (Legacy Bootstrap absorbed).
- **[User Story](USER_STORY.md)** - The "why" and user personas.
- **[Inspirations](INSPIRATIONS.md)** - Technical and conceptual foundations.

### 🛠 Development & Ops
- **[Sovereign Workflow](WORKFLOW.md)** - The SDD→BDD→TDD→DDD process.
- **[DevOps & Setup](DEVOPS.md)** - Dev containers, CI, security, and hardware requirements.
- **[PR Quality Governance](PR_QUALITY_GOVERNANCE.md)** - Guardrails and publishing hygiene.
- **[Decision Log](decision-log.md)** - Record of high-impact architectural choices.

### 📦 Ecosystem & Plugins
- **[Package Registry](../packages/README.md)** - *[NEW]* Catalog of all monorepo components.
- **[Plugin Developer Playbook](PLUGIN_DEVELOPER_PLAYBOOK.md)** - Guide for building sovereign extensions.
- **[WASM & JCO](WASM_JCO_ARCHITECTURE.md)** - Technical details of the plugin sandbox (transpilation flow, runtime vs build-time table, CI/CD alignment).
- **[ADR-044: WASM Plugin Loading — Browser Strategy](../specs/ADRs/ADR-044-wasm-plugin-loading-browser-strategy.md)** - Export conditions, PluginHost browser stub, OPFS install-time transpilation path.
- **[Plugin Developer Stories](PLUGIN_DEVELOPER_STORIES.md)** - Jornada do desenvolvedor de plugin: do uso pessoal ao ecossistema P2P. Proposta soberana, mecanismos de distribuição (hoje e amanhã), tabela de status.

---

## Distribution & Publishing

Guias para transferência organizacional e distribuição pública de pacotes:

- **[Pre-Migration Cleanup Checklist](PRE_MIGRATION_CLEANUP_CHECKLIST.md)** - Remove documentation "gordura" agora (ESTADO_ATUAL, research consolidation)
- **[Documentation Cleanup Plan](DOCUMENTATION_CLEANUP_PLAN.md)** - Detailed analysis of doc reduction opportunities
- **[Repository Migration Guide](REPOSITORY_MIGRATION_GUIDE.md)** - Complete transfer playbook (será deletado pós-migração)
- **[Post-Transfer Checklist](POST_TRANSFER_CHECKLIST.md)** - Immediate actions after org transfer (npm setup, CI/CD, final cleanup)
- **[ADR-019: npm Scope Strategy](../specs/ADRs/ADR-019-npm-scope-and-namespace-strategy.md)** - Decision rationale for `@refarm.dev` (includes caveats)
- **[Distribution Status](../packages/DISTRIBUTION_STATUS.md)** - Current state of publishable packages

---

## Technical Research (Reference)

Wiki de fundamentação técnica - consultar quando necessário:

- **[Phase 1 Foundations](research/phase1-technical-foundations.md)** - 16 tecnologias core validadas (PWA, OPFS, CRDT, WebLLM, etc)
- **[Critical Validations](research/critical-validations.md)** - 4 validações críticas (WebLLM Workers, CRDT+OPFS, WASI, Schema)
- **[Phases 2-4 Research](research/phases2-4-technical-research.md)** - Tecnologias futuras (Matrix, Nostr, MediaPipe, etc)
- **[Design System Bootstrap Discussion](research/design-system-bootstrap-discussion.md)** - Critérios de timing para bootstrap headless com sane defaults, a11y e i18n

---

## Quick Reference

### Como começar?

1. Leia [ARCHITECTURE.md](ARCHITECTURE.md) (visão geral)
2. Entenda [WORKFLOW.md](WORKFLOW.md) (processo de desenvolvimento)
3. Veja [roadmaps/MAIN.md](../roadmaps/MAIN.md) (próximos passos)
4. Consulte [research/](research/) quando precisar de fundamentação técnica

### Onde documentar decisões?

- Decisões em andamento/pending → [decision-log.md](decision-log.md)
- Decisões arquiteturais → [specs/ADRs/README.md](../specs/ADRs/README.md) (durante SDD)
- Especificações de features → [specs/features/](../specs/features/) (durante SDD)
- Comportamento esperado → Integration tests (durante BDD)
- Contratos de código → Unit tests (durante TDD)

### Estrutura do projeto

```
refarm/
├── apps/           Aplicações (tractor, studio)
├── packages/       Packages reutilizáveis (storage, sync, identity)
├── docs/           Esta pasta - documentação & pesquisa técnica
├── roadmaps/       Planejamento versionado (semver)
└── specs/          Specs & ADRs (SDD)
```
