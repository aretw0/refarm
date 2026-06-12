# Refarm Documentation

**Status**: Active Development
**Last Updated**: 2026-05-15

---

## 🏛 Philosophy & Vision

- **[ARCHITECTURE](ARCHITECTURE.md)** — System design, layers, evolutionary roadmap.
- **[Refarm as Personal OS Boot](REFARM_AS_OS_BOOT.md)** — Boot sequence L0–L5: Shell Load → Tractor Ignition → Identity → Graph → Plugins → System Live.
- **[User Story](USER_STORY.md)** — The "why" and user personas.
- **[Inspirations](INSPIRATIONS.md)** — Technical and conceptual foundations.
- **[Vision 2026: AI Agent Sovereignty](proposals/VISION_2026_AI_AGENT_SOVEREIGNTY.md)** — North star for autonomous sovereign agents.
- **[Synergy: AI Agent & TEM](proposals/SYNERGY_AI_AGENT_TEM.md)** — Tolman-Eichenbaum Machine as the agent's cognitive map.
- **[Agent Cognitive Model](../AGENTS.md#0-epistemic-framework-active-inference)** — Active Inference principles governing AI behavior in this repo.

---

## 🛠 Development & Ops

- **[Sovereign Workflow](WORKFLOW.md)** — SDD→BDD→TDD→DDD process.
- **[DevOps & Setup](DEVOPS.md)** — Dev containers, CI, security, hardware requirements.
- **[Process Playbook](PROCESS_PLAYBOOK.md)** — Daily operational commands: services, agents, smoke gates, troubleshooting.
- **[Operator Daily Driver](REFARM_OPERATOR_DAILY_DRIVER.md)** — Short maintained loop for using Refarm as the daily CLI driver.
- **[Operator Primitives](OPERATOR_PRIMITIVES.md)** — Stable JSON, session, task, runtime, model, and finish primitives for agentic operation.
- **[Action Readiness Cookbook](REFARM_ACTION_READINESS_COOKBOOK.md)** — JSON handoff contract, `nextCommand` rules, and end-of-slice agent finish flow.
- **[PoC Validation Pressure](POC_VALIDATION_PRESSURE.md)** — How local draft pressure maps to reusable Refarm validations without coupling to private writing workflows.
- **[PoC Prize Readiness](POC_PRIZE_READINESS.md)** — Gap analysis between deterministic validation POCs and submission-ready demonstration packets.
- **[PoC Writing Handoff](POC_WRITING_HANDOFF.md)** — Sanitized map from generated POC artifacts to proposal-writing claims and limits.
- **[Text Quality Config](TEXT_QUALITY_CONFIG.md)** — Dependency-free prose scoring contract, `.refarm/text-quality.json` discovery, and JSON error shape.
- **[Colony Playbook](COLONY_PLAYBOOK.md)** — Parallel agent batch execution guide.
- **[Known Limitations](KNOWN_LIMITATIONS.md)** — Technical hurdles, resource quotas, expected build behavior.
- **[PR Quality Governance](PR_QUALITY_GOVERNANCE.md)** — Guardrails and publishing hygiene.
- **[Decision Log](decision-log.md)** — Record of high-impact architectural choices.
- **[Stratification Policy](STRATIFICATION.md)** — TS-Strict vs JS-Atomic package classification.
- **[Scaffolding Development Policy](SCAFFOLDING.md)** — Island Isolation Policy for `sower` scaffolding.
- **[Local Disk Hygiene](local-disk-hygiene.md)** — Resource-aware cleanup tiers for constrained workstations.
- **[Module Resolution](DEVELOPMENT_RESOLUTION.md)** — src vs dist vs package root: when and why.
- **[Security: CI Cache Hardening](security/ci-cache-hardening.md)** — Cache poisoning attack surface, PR vs main isolation, maintenance rules.

---

## 📦 Ecosystem & Plugins

- **[Package Registry](../packages/README.md)** — Catalog of all monorepo components.
- **[Plugin Developer Playbook](PLUGIN_DEVELOPER_PLAYBOOK.md)** — Guide for building sovereign extensions.
- **[Plugin Authoring Tracks](PLUGIN_AUTHORING_TRACKS.md)** — Rust vs TS plugin paths, complexity tiers.
- **[Extensibility Model](EXTENSIBILITY_MODEL.md)** — Multi-surface plugin model.
- **[WASM & JCO](WASM_JCO_ARCHITECTURE.md)** — Plugin sandbox: transpilation flow, runtime vs build-time table.
- **[Courier Plugin](COURIER.md)** — `@refarm.dev/plugin-courier`: dynamic routing and protocol agnosticism.

---

## 🚀 Release Planning

- **[v0.1.0 Release Gate](v0.1.0-release-gate.md)** — Daily-driver-first gate; contract publication on hold until Refarm replaces the current pi workflow.
- **[Daily Driver Control Plane Plan](superpowers/plans/2026-05-17-refarm-daily-driver-control-plane.md)** — Convergence lane for Farmhand as the local/remote control plane, plugin safety, TUI/PWA clients, and documentation alignment before publication.
- **[Daily-Driver Parity Checklist](DAILY_DRIVER_PARITY.md)** — Capability checklist mapping pi workflow to Refarm surfaces.
- **[Gate 3 Spec](gate3-homestead-tractor-spec.md)** — Homestead × Tractor integration spec.
- **[Schema Migration Strategy](schema-migration-strategy.md)** — SCHEMA_V1 freeze, upgrade contract, `refarm migrate` CLI.
- **[Distro Evolution Model](distro-evolution-model.md)** — Bootstrap → Sovereign → Social canonical spec.

---

## 📤 Distribution & Publishing

- **[Pre-Migration Cleanup Checklist](PRE_MIGRATION_CLEANUP_CHECKLIST.md)** — Preparation for org transfer (transfer pending).
- **[Repository Migration Guide](REPOSITORY_MIGRATION_GUIDE.md)** — Org transfer playbook.
- **[Post-Transfer Checklist](POST_TRANSFER_CHECKLIST.md)** — Immediate actions after transfer (CI/CD, npm setup).
- **[Distribution Status](../packages/DISTRIBUTION_STATUS.md)** — Current state of publishable packages.

---

## 🔬 Technical Research (Reference)

- **[WASM Validation](research/wasm-validation.md)**
- **[Lock Strategies Comparison](research/LOCK_STRATEGIES_COMPARISON.md)**
- **[Plugin Ecosystem Lessons](research/PLUGIN_ECOSYSTEM_LESSONS.md)**
- **[Refarm vs Spin Mapping](research/refarm-vs-spin-mapping.md)**
- **[Design System Bootstrap](research/design-system-bootstrap-discussion.md)**
- **[TEM Sovereign Graph Design](research/tem-sovereign-graph-design.md)**
- **[Graph Native Publishing](research/graph-native-publishing.md)**

---

## Quick Reference

### Como começar?

1. Leia [ARCHITECTURE.md](ARCHITECTURE.md) (visão geral)
2. Entenda [WORKFLOW.md](WORKFLOW.md) (processo de desenvolvimento)
3. Veja [roadmaps/MAIN.md](../roadmaps/MAIN.md) (próximos passos)
4. Siga o [REFARM_OPERATOR_DAILY_DRIVER.md](REFARM_OPERATOR_DAILY_DRIVER.md) para o fluxo curto de daily driver

### Onde documentar decisões?

- Decisões em andamento/pending → [decision-log.md](decision-log.md)
- Decisões arquiteturais → [specs/ADRs/README.md](../specs/ADRs/README.md)
- Especificações de features → [specs/features/](../specs/features/)
- Comportamento esperado → integration tests (BDD)
- Contratos de código → unit tests (TDD)

### Estrutura do projeto

```
refarm/
├── apps/           Distros (apps/me · apps/dev · apps/farmhand)
├── packages/       Packages reutilizáveis (storage, sync, identity, tractor)
├── docs/           Esta pasta — documentação & pesquisa técnica
├── roadmaps/       Planejamento versionado
└── specs/          Specs & ADRs (SDD)
```
