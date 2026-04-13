# Refarm Documentation

**Status**: Active Development
**Last Updated**: 2026-03-21

---

## 🗺 Knowledge Map (Architecture of Truth)

### 🏛 Philosophy & Vision
- **[ARCHITECTURE](ARCHITECTURE.md)** — System design, Evolutionary Roadmap (Legacy Bootstrap absorbed).
- **[Refarm as Personal OS Boot](REFARM_AS_OS_BOOT.md)** — Sequência de boot L0–L5: Shell Load → Tractor Ignition → Identity → Graph → Plugins → System Live.
- **[VISION 2026: AI Agent Sovereignty](proposals/VISION_2026_AI_AGENT_SOVEREIGNTY.md)** - *[NEW]* The North Star for Autonomous Sovereign Agents.
- **[SYNERGY: AI Agent & TEM](proposals/SYNERGY_AI_AGENT_TEM.md)** - *[NEW]* How the Tolman-Eichenbaum Machine acts as the agent's cognitive map.
- **[User Story](USER_STORY.md)** - The "why" and user personas.
- **[Inspirations](INSPIRATIONS.md)** - Technical and conceptual foundations.
- **[Agent Cognitive Model](../AGENTS.md#0-epistemic-framework-active-inference)** - Active Inference principles governing AI agent behavior in this repository.

### 🛠 Development & Ops
- **[Sovereign Workflow](WORKFLOW.md)** — The SDD→BDD→TDD→DDD process.
- **[DevOps & Setup](DEVOPS.md)** - Dev containers, CI, security, and hardware requirements.
- **[Known Limitations](KNOWN_LIMITATIONS.md)** - *[NEW]* Technical hurdles, resource quotas, and expected build behavior.
- **[PR Quality Governance](PR_QUALITY_GOVERNANCE.md)** — Guardrails and publishing hygiene.
- **[Decision Log](decision-log.md)** — Record of high-impact architectural choices.
- **[Stratification Policy](STRATIFICATION.md)** — TS-Strict vs JS-Atomic package classification. Defines hybrid coexistence rules (`tsconfig.build.json` presence = TS-Strict; see AGENTS.md Rule 4).
- **[Scaffolding Development Policy](SCAFFOLDING.md)** — Island Isolation Policy for `sower` scaffolding: never run `refarm init` within the monorepo root.

### 📦 Ecosystem & Plugins
- **[Package Registry](../packages/README.md)** - *[NEW]* Catalog of all monorepo components.
- **[Plugin Developer Playbook](PLUGIN_DEVELOPER_PLAYBOOK.md)** - Guide for building sovereign extensions.
- **[WASM & JCO](WASM_JCO_ARCHITECTURE.md)** - Technical details of the plugin sandbox (transpilation flow, runtime vs build-time table, CI/CD alignment).
- **[ADR-044: WASM Plugin Loading — Browser Strategy](../specs/ADRs/ADR-044-wasm-plugin-loading-browser-strategy.md)** - Export conditions, PluginHost browser stub, OPFS install-time transpilation path.
- **[Plugin Developer Stories](PLUGIN_DEVELOPER_STORIES.md)** — Jornada do desenvolvedor de plugin: do uso pessoal ao ecossistema P2P. Proposta soberana, mecanismos de distribuição (hoje e amanhã), tabela de status.
- **[Courier Plugin](COURIER.md)** — `@refarm.dev/plugin-courier`: dynamic routing (local-first mDNS, relay fallback, P2P mesh) and protocol agnosticism (Nostr, Matrix, AT Protocol, Bluetooth Mesh).

### 🚀 Vision 2026: AI Agent Sovereignty
- **[Vision 2026 Document](proposals/VISION_2026_AI_AGENT_SOVEREIGNTY.md)** - *[NEW]* Deep dive into the Agentic Autonomy roadmap.
- **[Synergy with TEM](proposals/SYNERGY_AI_AGENT_TEM.md)** - *[NEW]* The relationship between the Agênte and the Cognitive Map (TEM).

### 🚀 Future Tracks (See Roadmap)
Detailed planning for the following tracks is now consolidated in the **[Evolutionary Roadmap](../roadmaps/MAIN.md)**:
- 🦀 **Tractor-Rust Native**: The `wasmtime` port of Tractor for 10MB memory-constrained edge devices. See [ADR-047](../specs/ADRs/ADR-047-tractor-native-rust-host.md) and [ADR-049](../specs/ADRs/ADR-049-post-graduation-horizon.md).
- 🚜 **Farmhand Daemons**: Headless, background Tractor instances for offline CRDT task completion.
- 🧠 **Tractor-Embedded Agents**: Incorporating local AI models directly into the Tractor WASM sandbox execution.

---

## Release Planning

Checklists e guias para release v0.1.0 com suporte dual (scope pessoal agora, org depois):

- **[v0.1.0 Release Gate](v0.1.0-release-gate.md)** — Gate checklist (3a: technical primitives + 3b: apps/me consolidated)
- **[Gate 3 Spec](gate3-homestead-tractor-spec.md)** — Homestead × Tractor integration spec (POC vs consolidated distro)
- **[Schema Migration Strategy](schema-migration-strategy.md)** — SCHEMA_V1 freeze, upgrade contract, `refarm migrate` CLI
- **[Distro Evolution Model](distro-evolution-model.md)** — Bootstrap → Sovereign → Social canonical spec

## Distribution & Publishing

Guias para distribuição pública e transferência organizacional:

- **[Pre-Migration Cleanup Checklist](PRE_MIGRATION_CLEANUP_CHECKLIST.md)** — Preparação para migração de owner/org sem bloquear publicação no scope ativo
- **[Repository Migration Guide](REPOSITORY_MIGRATION_GUIDE.md)** — Playbook de org transfer (quando aplicável)
- **[Post-Transfer Checklist](POST_TRANSFER_CHECKLIST.md)** — Ações imediatas pós-transfer (release gates, npm setup, CI/CD)
- **[ADR-019: npm Scope Strategy](../specs/ADRs/ADR-019-npm-scope-and-namespace-strategy.md)** — Rationale do scope alvo da organização
- **[Distribution Status](../packages/DISTRIBUTION_STATUS.md)** — Current state of publishable packages

---

## Technical Research (Reference)

Wiki de fundamentação técnica - consultar quando necessário:

- **[Phase 1 Foundations](research/phase1-technical-foundations.md)** - 16 tecnologias core validadas (PWA, OPFS, CRDT, WebLLM, etc)
- **[Critical Validations](research/critical-validations.md)** - 4 validações críticas (WebLLM Workers, Loro CRDT+SQLite CQRS, WASI, Schema)
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
├── apps/           Distros (apps/me · apps/dev · apps/farmhand)
├── packages/       Packages reutilizáveis (storage, sync, identity)
├── docs/           Esta pasta - documentação & pesquisa técnica
├── roadmaps/       Planejamento versionado (semver)
└── specs/          Specs & ADRs (SDD)
```
