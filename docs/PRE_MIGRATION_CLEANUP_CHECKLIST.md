# Pre-Migration Documentation Cleanup Checklist

**Objetivo**: Remover "gordura" documental AGORA, antes de transferir o repositório  
**Tempo estimado**: 15-30 minutos  
**Status**: OPCIONAL (mas recomendado)

---

## ✅ Limpeza Tier 1: Essencial (Faça Agora)

### [ ] 1. Consolidar ESTADO_ATUAL.md em decision-log.md

**Arquivo afetado**: `docs/ESTADO_ATUAL.md` (80 linhas)

ESTADO_ATUAL.md é um documento de **status histórico** que será obsoleto após a migração. Suas informações importantes devem ir para `decision-log.md`.

```bash
# 1. Abra decision-log.md e adicione:

## 2026-03-07: Pre-Migration Preparation Complete

**Status**: ✅ Distribution-ready  
**What**: Prepared capability contracts for public npm distribution  
**Context**:
- 4 packages ready: storage-contract-v1, sync-contract-v1, identity-contract-v1, plugin-manifest  
- Adopted @refarm.dev npm scope (documented in ADR-019)  
- Performance optimized: 6 conformance tests run in ~6s  
- CI/CD: automated release workflows with safety gates

**Decisions Made**:
- npm scope: @refarm.dev (vs @refarm-dev or @refarm)
  Rationale: Aligns with domain, fallback to @refarm-dev documented in ADR-019
- Release strategy: Changesets-based (vs manual tags)
  Rationale: Safer, auto-creates PRs before publish

**Owner**: @aretw0 + GitHub Copilot  
**Evidence**: 
- commits 7597ac6...988fac1 (8 atomic commits)
- specs/ADRs/ADR-019-npm-scope-and-namespace-strategy.md

# 2. Deletar docs/ESTADO_ATUAL.md
rm docs/ESTADO_ATUAL.md

# 3. Commit
git add docs/decision-log.md docs/
git commit -m "docs: consolidate pre-migration status into decision-log"
git push origin main
```

**Antes**: 80 + 34 = 114 linhas  
**Depois**: ~50 linhas consolidadas (melhor estrutura)

---

## ✅ Limpeza Tier 2: Research Consolidation (Recomendado)

### [ ] 2. Criar docs/research/INDEX.md (Abstrair Pesquisas em ADRs)

**Problema**: `docs/research/` tem 2754 linhas, muitas conclusões já documentadas em ADRs  
**Solução**: Criar índice com resumos + referências a ADRs, remover arquivos redundantes

```bash
# 1. Criar novo arquivo docs/research/INDEX.md (copiar conteúdo abaixo)
# 2. Deletar documentos obsoletos:
rm docs/research/phase1-technical-foundations.md
rm docs/research/phases2-4-technical-research.md

# 3. Manter como arquivo histórico (para contexto detalhado):
# docs/research/browser-extension-discussion.md (631 linhas)
# docs/research/critical-validations.md (416 linhas)
# docs/research/wasm-validation.md (408 linhas)
# docs/research/competitive-analysis.md (453 linhas)
# docs/research/design-system-bootstrap-discussion.md (195 linhas)

# 4. Commit
git add docs/research/
git commit -m "docs: consolidate research findings into ADR references"
git push origin main
```

**Conteúdo para docs/research/INDEX.md:**

```markdown
# Research Archive & Reference Index

Este índice consolida decisões de pesquisa técnica. Para detalhes, consulte os ADRs ou arquivos históricos.

## Pesquisas Concluídas

### Architecture & Core Patterns

| Research | Decision | ADR Reference |
|----------|----------|---------------|
| Offline-first + sync architecture | CRDT for eventual consistency | [ADR-003: CRDT Synchronization](../../specs/ADRs/ADR-003-crdt-synchronization.md) |
| Data persistence | SQLite with OPFS | [ADR-015: SQLite Engine Decision](../../specs/ADRs/ADR-015-sqlite-engine-decision.md) |
| OPFS validation | Deferred to BDD phase | [ADR-009: OPFS Persistence Strategy](../../specs/ADRs/ADR-009-opfs-persistence-strategy.md) |
| Network abstraction | Provider-based adapters | [ADR-005: Network Abstraction Layer](../../specs/ADRs/ADR-005-network-abstraction-layer.md) |

### Identity & Auth

| Research | Decision | ADR Reference |
|----------|----------|---------------|
| Browser extension signer | Deferred to Phase 2 | [ADR-008: Ecosystem Technology Boundary](../../specs/ADRs/ADR-008-ecosystem-technology-boundary.md) |
| Nostr integration | Explored, deferred | research/browser-extension-discussion.md |

### Plugin System

| Research | Decision | ADR Reference |
|----------|----------|---------------|
| Capability contracts | Versioned interfaces (v1, v2...) | [ADR-018: Capability Contracts](../../specs/ADRs/ADR-018-capability-contracts-and-observability-gates.md) |
| Manifest schema | JSON-LD + observability gates | [ADR-018](../../specs/ADRs/ADR-018-capability-contracts-and-observability-gates.md) |

### Validation & Safety

| Research | Decision | ADR Reference |
|----------|----------|---------------|
| WASM compilation | Valid, manual testing required | research/wasm-validation.md |
| Critical paths | Browser API + persist + sync | research/critical-validations.md |
| Schema evolution | Versioning policy | [ADR-010: Schema Evolution](../../specs/ADRs/ADR-010-schema-evolution.md) |

## Historical Research (For Context)

Se precisa de análise detalhada de decisões antigas:

- **[browser-extension-discussion.md](browser-extension-discussion.md)** - Detailed browser extension & native interop analysis
- **[competitive-analysis.md](competitive-analysis.md)** - Competitive landscape of similar products
- **[critical-validations.md](critical-validations.md)** - Critical path validation procedures
- **[wasm-validation.md](wasm-validation.md)** - WASM performance & runtime testing
- **[design-system-bootstrap-discussion.md](design-system-bootstrap-discussion.md)** - Design system timing considerations

## How to Use This Index

1. **Looking for a decision?** → Check the table above, go to the ADR
2. **Need historical context?** → See Historical Research section
3. **Adding new research?** → Create ADR, add row to table above, archive detailed notes here

**Maintenance**: Update this index when new ADRs are created.
```

**Antes**: 2754 linhas em 7 arquivos  
**Depois**: ~400 linhas com referências + 2000 linhas em arquivos históricos (organized, discoverable)

---

## ✅ Limpeza Tier 3: Optional Review (Pós-Migração)

### [ ] 3. Revisar WORKFLOW.md vs PR_QUALITY_GOVERNANCE.md (DEPOIS)

**Problema**: Possível sobreposição entre 593 linhas (WORKFLOW) vs 471 linhas (PR_QUALITY)  
**Ação**: Revisar pós-migração, consolidar se necessário

**Nota**: Deixar para depois porque ambos documentam coisas validas mas com foco diferente:

- WORKFLOW.md = Processo de desenvolvimento (SDD→BDD→TDD→DDD)
- PR_QUALITY_GOVERNANCE.md = Quality gates específicas (eslint, tests, etc)

---

## 📊 Resumo de Impacto

### Antes (Pré-Migração)

```
Arquivo              Linhas   Status
─────────────────────────────────
ESTADO_ATUAL.md         80    ← CONSOLIDATE
decision-log.md         34    ← receberá conteúdo
research/ (7 arquivos) 2754   ← REDUZIR
REPOSITORY_MIGRATION_GUIDE 252 ← deletar pós-migração
────────────────────────────
TOTAL DOCS: ~7664 linhas
```

### Depois (Pós-Migração)

```
Arquivo              Linhas   Status
─────────────────────────────────
decision-log.md        ~84    (consolidou ESTADO_ATUAL)
research/
  - INDEX.md           ~100   (novo índice)
  - historical/ (4 arquivos)  (mantém referência)
research/ (reduzido)   ~2000  (vs 2754, -26%)
No REPOSITORY_MIGRATION_GUIDE   (executado, deletado)
────────────────────────────
TOTAL DOCS: ~5000-5500 linhas (33% redução)
```

---

## 🎯 Execution Plan

### AGORA (Pré-Migração): 15-30 min

```bash
# 1. Consolidar ESTADO_ATUAL em decision-log
# 2. Criar research/INDEX.md
# 3. Deletar arquivos research redundantes
# 4. Commit tudo

git add docs/
git commit -m "docs: pre-migration cleanup - consolidate research and status"
git push origin main
```

### Pós-Migração (Dia 1-2): 5-10 min

```bash
# Já coberto em POST_TRANSFER_CHECKLIST.md

rm docs/REPOSITORY_MIGRATION_GUIDE.md
git add docs/
git commit -m "docs: post-migration cleanup - remove migration guide"
git push origin main
```

---

## 📝 Críterios de Limpeza

✅ **Keep** (documentação essencial):

- ADRs e decisões arquiteturais
- ARCHITECTURE.md (visão geral)
- WORKFLOW.md (processo)
- PR_QUALITY_GOVERNANCE.md (gates)
- DEVOPS.md (setup)
- A11Y_I18N_GUIDE.md (política)
- PLUGIN_DEVELOPER_PLAYBOOK.md (devs externos)
- decision-log.md (histórico de decisões)

❌ **Remove** (documentação descartável):

- REPOSITORY_MIGRATION_GUIDE.md (após execução)
- ESTADO_ATUAL.md (status histórico → decision-log)
- Arquivos de research que duplicam ADRs

📌 **Archive** (histórico, referência):

- research/browser-extension-discussion.md
- research/critical-validations.md
- research/wasm-validation.md
- research/competitive-analysis.md

---

## ⚠️ Rollback (Se Necessário)

Se decidir não fazer limpeza agora, todos os arquivos permanecem. Pós-migração você sempre pode:

```bash
# Se quiser resgatar um arquivo deletado prematuro:
git checkout <commit-hash> -- docs/ESTADO_ATUAL.md
```

---

## ✅ Checklist de Execução

- [ ] Lido este documento completamente
- [ ] Revisado ESTADO_ATUAL.md para consolidação
- [ ] Criado novo research/INDEX.md (copiar template acima)
- [ ] Deletado phase1-technical-foundations.md
- [ ] Deletado phases2-4-technical-research.md
- [ ] Deletado ESTADO_ATUAL.md
- [ ] git commit -m "docs: pre-migration cleanup"
- [ ] Verifi

cado que builds/testes ainda passam

- [ ] git push origin main

**Status**: ✅ Ready for transfer

---

**Recomendação Final**: Faça a **Tier 1 (consolidação)** AGORA. Tier 2 (research) é opcional mas recomendado se quer documentação "enxuta". Tier 3 pode esperar.
