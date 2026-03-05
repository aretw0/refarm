# Refarm - Main Roadmap

**Semantic Versioning**: Major.Minor.Patch  
**Current**: v0.0.1-dev  
**Next Release**: v0.1.0 (MVP Core)

---

## Release Strategy

- **Patch (0.0.x)**: Bug fixes, documentation
- **Minor (0.x.0)**: New features, non-breaking changes
- **Major (x.0.0)**: Breaking changes, architectural shifts

Each release follows: **SDD → BDD → TDD → DDD** (see [Workflow Guide](../docs/WORKFLOW.md))

**Why this flow?**

- **SDD**: Define specs/ADRs before coding (prevents chaos)
- **BDD**: Write integration tests that FAIL (expected behavior)
- **TDD**: Write unit tests that FAIL (contracts)
- **DDD**: Implement until tests PASS (green phase)

**Quality Gates**: Cannot proceed to next phase until previous is peer-reviewed and complete.

---

## v0.1.0 - MVP Core (Em planejamento)
**Milestone**: Offline-first storage + sync foundation  
**Target**: Sprint 1-2

### Pre-SDD: Research & Validation (Semana 1-2)
*(Verificações técnicas antes de especificar)*

- [ ] Completar Validação 3: WASI capability enforcement (compilação + teste)
- [ ] Completar Validação 4: JSON-LD schema evolution (exemplo prático)
- [ ] Criar PoC mínimo validando interop (Storage + CRDT em Web Worker)
- [ ] Benchmark SQLite Wasm vs sql.js (operações alta frequência)
- [ ] Benchmark CRDT bulk operations (OPFS persistence)

**Decision Gate**: ✅ Validações 3-4 confirmadas → proceed to SDD

### SDD (Spec Driven Development)

- [ ] ADR-001: Monorepo structure & workspace boundaries
- [ ] ADR-002: Offline-first strategy (Storage → Sync → Network)
- [ ] ADR-003: CRDT choice (Yjs) + conflict resolution
- [ ] Spec: Storage interface (`storage-sqlite` package)
- [ ] Spec: Sync interface (`sync-crdt` package)

### BDD (Behaviour Driven Development)

- [ ] Integration: App persists data offline
- [ ] Integration: Data syncs between 2 clients
- [ ] Integration: Conflicts merge automatically
- [ ] Acceptance: User works offline, syncs when online

### TDD (Test Driven Development)

- [ ] Unit: Storage CRUD contracts
- [ ] Unit: CRDT merge operations
- [ ] Unit: Conflict resolution rules
- [ ] Coverage: >80% core logic

### DDD (Domain Driven Implementation)

- [ ] Domain: `storage-sqlite` (persistence boundary)
- [ ] Domain: `sync-crdt` (sync boundary)
- [ ] Domain: `kernel` (orchestration)
- [ ] Infra: OPFS adapters, Yjs providers

### CHANGELOG (when done)
TBD - to be generated from completed work

---

## v0.2.0 - Identity + Network (Futuro)
**Milestone**: Nostr identity + Matrix network  
**Status**: Aguardando v0.1.0

### SDD

- [ ] ADR-004: Identity provider choice (Nostr)
- [ ] ADR-005: Network abstraction layer
- [ ] Spec: `identity-nostr` package interface

*(Details after v0.1.0 completion)*

---

## v0.3.0 - Local AI (Futuro)
**Milestone**: WebLLM + Transformers.js integration  
**Status**: Aguardando v0.2.0

### SDD

- [ ] ADR-006: LLM execution strategy (Web Workers)
- [ ] Spec: AI inference interface

*(Details after v0.2.0 completion)*

---

## Backlog: Cross-Cutting Concerns

**Status**: ADRs futuras para após fundações estáveis

### Observability & Introspection (ADR-007)

**Status**: 📝 DRAFT (In Research)
**Priority**: v0.2.0 ou v0.3.0
**Complexity**: 🔴 Alta

**Problema**:

Como estabelecer primitivas de observabilidade coesas quando:

- Kernel, plugins, e primitivas têm estados independentes
- Cada componente pode ter suas próprias formas de trace/telemetria
- Sistema é meta (composto emergentemente)
- Debugging precisa ser profundo mas não-invasivo

**Requisitos**:

- [ ] SDK expõe primitives de telemetria (events, metrics, traces, logs)
- [ ] Plugins podem observar estado sem comprometer segurança
- [ ] Monitoramento em tempo real viável
- [ ] Dashboards podem ser compostos emergentemente
- [ ] "Events sobre events" (meta-observabilidade)
- [ ] Self-healing: sistema se recupera de erros automaticamente
- [ ] Telemetria opt-in (default: OFF), anonimizada, transparente
- [ ] Pluggability: usuários conectam seus próprios providers

**Decisão Proposta**: Hybrid Approach (Core Primitives + Pluggable Observers)

**Ver Detalhes Completos**: [specs/ADRs/ADR-007-observability-primitives.md](../specs/ADRs/ADR-007-observability-primitives.md)

---

## v1.0.0 - Production Ready (Meta)
**Milestone**: Full feature parity + stability  
**Criteria**:

- All critical paths covered by tests
- Documentation complete
- Performance benchmarks met
- Security audit passed

---

## Package-Specific Roadmaps

Ver roadmaps individuais para detalhes de implementação:

- [apps/kernel/ROADMAP.md](../apps/kernel/ROADMAP.md)
- [apps/studio/ROADMAP.md](../apps/studio/ROADMAP.md)
- [packages/storage-sqlite/ROADMAP.md](../packages/storage-sqlite/ROADMAP.md)
- [packages/sync-crdt/ROADMAP.md](../packages/sync-crdt/ROADMAP.md)
- [packages/identity-nostr/ROADMAP.md](../packages/identity-nostr/ROADMAP.md)

---

## Process Notes

**Como usar este roadmap:**

1. Cada release = milestone com escopo fechado
2. Cada fase tem quality gates (ver [WORKFLOW.md](../docs/WORKFLOW.md))
3. **SDD** primeiro (specs/ADRs) → decisões arquiteturais
4. **BDD** segundo (integration tests RED) → comportamento esperado
5. **TDD** terceiro (unit tests RED) → contratos detalhados
6. **DDD** por último (implementation) → código até tests GREEN

**Quality Gates (não pula fases sem peer review)**:

- SDD → BDD: ADRs completos, specs sem TODO
- BDD → TDD: Integration tests escritos (FAILING)
- TDD → DDD: Unit tests escritos (FAILING)
- DDD → Done: All tests GREEN, coverage ≥80%, changeset criado

**Tracking progress:**

- CHANGELOGs gerados a partir de changesets (`npm run changeset:version`)
- Checklists migram para issues/PRs quando começamos sprint
- Decisões importantes viram ADRs em `specs/ADRs/`

**Referências técnicas:**

- [docs/WORKFLOW.md](../docs/WORKFLOW.md) - Workflow detalhado (SDD→BDD→TDD→DDD)
- [docs/research/](../docs/research/) - Wiki de fundamentação técnica
- [specs/ADRs/](../specs/ADRs/) - Architecture Decision Records
- [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) - Visão geral do sistema
