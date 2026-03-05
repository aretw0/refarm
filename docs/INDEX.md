# Refarm Documentation

**Status**: Active Development  
**Last Updated**: 2026-03-04

---

## Active Development

- **[Main Roadmap](../roadmaps/MAIN.md)** - Semantic versioning & milestones (SDD→BDD→TDD→DDD)
- **[Development Workflow](WORKFLOW.md)** - Process guide: SDD→BDD→TDD→DDD with quality gates
- **[Architecture](ARCHITECTURE.md)** - System overview & design decisions
- **[Accessibility & i18n](A11Y_I18N_GUIDE.md)** - WCAG 2.2 + internationalization guide
- **[Specs & ADRs](../specs/)** - Specifications & Architecture Decision Records

---

## Technical Research (Reference)

Wiki de fundamentação técnica - consultar quando necessário:

- **[Phase 1 Foundations](research/phase1-technical-foundations.md)** - 16 tecnologias core validadas (PWA, OPFS, CRDT, WebLLM, etc)
- **[Critical Validations](research/critical-validations.md)** - 4 validações críticas (WebLLM Workers, CRDT+OPFS, WASI, Schema)
- **[Phases 2-4 Research](research/phases2-4-technical-research.md)** - Tecnologias futuras (Matrix, Nostr, MediaPipe, etc)

---

## Quick Reference

### Como começar?

1. Leia [ARCHITECTURE.md](ARCHITECTURE.md) (visão geral)
2. Entenda [WORKFLOW.md](WORKFLOW.md) (processo de desenvolvimento)
3. Veja [roadmaps/MAIN.md](../roadmaps/MAIN.md) (próximos passos)
4. Consulte [research/](research/) quando precisar de fundamentação técnica

### Onde documentar decisões?

- Decisões arquiteturais → [specs/ADRs/](../specs/ADRs/) (durante SDD)
- Especificações de features → [specs/features/](../specs/features/) (durante SDD)
- Comportamento esperado → Integration tests (durante BDD)
- Contratos de código → Unit tests (durante TDD)

### Estrutura do projeto

```
refarm/
├── apps/           Aplicações (kernel, studio)
├── packages/       Packages reutilizáveis (storage, sync, identity)
├── docs/           Esta pasta - documentação & pesquisa técnica
├── roadmaps/       Planejamento versionado (semver)
└── specs/          Specs & ADRs (SDD)
```
