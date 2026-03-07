# Plano de Limpeza de Documentação: Pré e Pós-Migração

**Objetivo**: Remover "gordura" agora, deixar apenas decisões e registros históricos  
**Data**: 2026-03-07  
**Fase**: Pre-transfer cleanup

---

## 📊 Audit de Documentação Atual

### Tamanho de Documentação (linhas)

```
5 arquivos core (MANTEM):
- ARCHITECTURE.md          297 linhas ✅ Keep
- DEVOPS.md                648 linhas ⚠️  Review
- WORKFLOW.md              593 linhas ⚠️  Consolidate
- PR_QUALITY_GOVERNANCE.md 471 linhas ⚠️  Consolidate?
- A11Y_I18N_GUIDE.md       391 linhas ✅ Keep

3 arquivos process (REVIEW):
- PLUGIN_DEVELOPER_PLAYBOOK.md  628 linhas (ok, external focus)
- BRANCH_PROTECTION_SETUP.md    310 linhas (post-transfer, pode reduzir)
- REPOSITORY_MIGRATION_GUIDE.md 252 linhas ❌ ARCHIVE após uso

1 histórico/status:
- ESTADO_ATUAL.md           80 linhas (consolidar em decision-log)

Research (2754 linhas total):
- browser-extension-discussion.md   631 linhas (abstract para ADR ref)
- competitive-analysis.md           453 linhas (abstract para ADR ref)
- critical-validations.md           416 linhas (abstract para ADR ref)
- wasm-validation.md                408 linhas (abstract para ADR ref)
- design-system-bootstrap-discussion.md  195 linhas (move to ADR or features/)
- phase1-technical-foundations.md        191 linhas (abstract to ADR refs)
- phases2-4-technical-research.md        189 linhas (abstract to ADR refs)
```

**Total documentação**: ~7664 linhas  
**Candidates para redução**: 2754 linhas (research/) + 252 linhas (migration guide) + overhead

---

## 🎯 Ações Imediatas (PRÉ-MIGRAÇÃO)

### Tier 1: REMOVER AGORA (sem utilidade pós-migração)

**1. ❌ Arquivar `docs/REPOSITORY_MIGRATION_GUIDE.md`**

**Por que**: Será executado uma única vez, depois não terá propósito operacional.

**O que fazer**:
```bash
# 1. Quando a migração for executada, criar um entry no decision-log.md:
## Decisão: Repository Transfer (2026-03-07)

**What**: Transferred aretw0/refarm → refarm-dev/refarm
**When**: 2026-03-07
**Proof**: Github org refarm-dev created, namespace protected with @refarm-dev npm scope
**Owner**: @aretw0, GitHub Copilot
**Decision**: Use @refarm.dev as primary npm scope (documented in ADR-019)

# 2. Deletar docs/REPOSITORY_MIGRATION_GUIDE.md
```

**Quando**: Após executar a migração (próximas 24h)

---

### Tier 2: REDUZIR/ABSTRAIR AGORA (research consolidation)

**2. 🔄 Consolidar `docs/research/` em índice + resumos**

**Problema**: 2754 linhas de research dispersas, muitas conclusões já em ADRs.

**Estratégia**:

```markdown
# docs/research/INDEX.md (NOVO - consolidado)

## Pesquisas Concluídas (Referências Históricas)

### PWA & Browser APIs
- Browser Extension Strategy → [ADR-008: Ecosystem Technology Boundary](../../specs/ADRs/ADR-008-ecosystem-technology-boundary.md)
- OPFS Persistence → [ADR-009: OPFS Persistence Strategy](../../specs/ADRs/ADR-009-opfs-persistence-strategy.md)
- Client-Side Validation → [ADR-013: Testing Strategy](../../specs/ADRs/ADR-013-testing-strategy.md)

### Architecture Decisions
- CRDT Sync → [ADR-003: CRDT Synchronization](../../specs/ADRs/ADR-003-crdt-synchronization.md)
- Network Abstraction → [ADR-005: Network Abstraction Layer](../../specs/ADRs/ADR-005-network-abstraction-layer.md)
- Schema Evolution → [ADR-010: Schema Evolution](../../specs/ADRs/ADR-010-schema-evolution.md)

### Full Research Archive (se precisar de contexto histórico)
- [browser-extension-discussion.md](browser-extension-discussion.md) - Detailed browser extension analysis
- [competitive-analysis.md](competitive-analysis.md) - Market competitive landscape
- [wasm-validation.md](wasm-validation.md) - WASM performance & viability testing
- [critical-validations.md](critical-validations.md) - Critical path validations

**Nota**: Arquivos base mantidos como referência. Use ADRs para decisões finais.
```

**Quando**: AGORA (antes de migração)  
**Ações**:
1. Criar novo `docs/research/INDEX.md` com referências consolidadas
2. Deletar: `phase1-technical-foundations.md`, `phases2-4-technical-research.md` (conteúdo está em ADRs)
3. Manter como arquivo: `browser-extension-discussion.md`, `critical-validations.md`, `wasm-validation.md`
4. Reduzir: `competitive-analysis.md` → move to roadmaps/ se necessário

**Resultado**: 2754 → ~400 linhas (só índice + referências)

---

### Tier 3: CONSOLIDAR/REVISAR AGORA

**3. 📋 Revisar `docs/ESTADO_ATUAL.md`**

**Problema**: Status history que eventual mente fica obsoleto. 80 linhas não é problema, mas pode migrar para decision-log.

**Quando**: AGORA  
**Ação**:
- Se contém decisões → mover para `decision-log.md`
- Se contém timeline → arquivar em `docs/sprints/`
- Deletar o arquivo (será atualizado pós-migração como POST_TRANSFER_STATUS.md)

---

### Tier 4: REVISAR OVERLAPS

**4. 🔄 Consolidar `WORKFLOW.md` (593) + `PR_QUALITY_GOVERNANCE.md` (471)?**

**Problema**: Ambos descrevem processo de desenvolvimento. Possível duplicação.

**Análise Necessária**: 
- Ler ambos pra entender se há sobreposição real
- Se SIM: consolidar em um arquivo core + um auxiliary
- Se NÃO: deixar como está (Workflow = descrição do processo, QG = gates específicas)

**Quando**: DEPOIS de revisar (pode ser pós-migração)

---

---

## ✅ Ações para POST-TRANSFER CHECKLIST

### Logo Após Transfer (Dentro de 24h)

**[POST_TRANSFER_CHECKLIST]** Adicionar seção **"Documentation Cleanup"**:

```markdown
## 📚 Documentation Cleanup (Post-Transfer Day 1)

### 1. Delete Migration Guide
```bash
rm docs/REPOSITORY_MIGRATION_GUIDE.md
git add -A
git commit -m "docs: remove migration guide (executed successfully)"
```

### 2. Archive Research Folders (if Tier 2 completed)
```bash
rm docs/research/phase1-technical-foundations.md
rm docs/research/phases2-4-technical-research.md
git add -A
git commit -m "docs: consolidate research into INDEX (see ADRs)"
```

### 3. Update ESTADO_ATUAL.md Content
- Move decision content to decision-log.md
- Delete ESTADO_ATUAL.md if empty
- Create POST_TRANSFER_STATUS.md for new phase status

### 4. Update All Internal URLs
- Find: `aretw0/refarm` → Replace: `refarm-dev/refarm`
- Find: `github.com/aretw0` → Replace: `github.com/refarm-dev`
- Run: `grep -r "aretw0" docs/ apps/ packages/` to find remaining refs

### 5. Update Team Documentation
- Update team wikis pointing to new GitHub org
- Update CI/CD secret references
- Update OAuth/SSO if necessary
```

---

## 📝 Checklist de Execução

### Pré-Migração (Agora)

- [ ] Revisar `docs/ESTADO_ATUAL.md` → consolidar em decision-log ou deletar
- [ ] Criar novo `docs/research/INDEX.md` com referências consolidadas
- [ ] Deletar arquivos research redundantes:
  - [ ] `phase1-technical-foundations.md` 
  - [ ] `phases2-4-technical-research.md`
- [ ] (Opcional) Revisar WORKFLOW.md vs PR_QUALITY_GOVERNANCE.md para consolidação
- [ ] Commit: `docs: pre-migration research consolidation`

### Pós-Migração (Dia 1-2)

- [ ] Deletar `REPOSITORY_MIGRATION_GUIDE.md`
- [ ] Executar find-replace (aretw0 → refarm-dev)
- [ ] Atualizar POST_TRANSFER_CHECKLIST (adicionado acima)
- [ ] Atualizar INDEX.md links
- [ ] Criar POST_TRANSFER_STATUS.md (novo phase status)
- [ ] Commit: `docs: post-transfer cleanup and org migration`

---

## 📊 Estimativa de Redução

| Fase | Antes | Depois | Redução |
|------|-------|--------|----------|
| Pré-migração research cleanup | 2754 | 400 | 2354 linhas |
| Pós-migração guide deletion | 252 | 0 | 252 linhas |
| **Total** | **~7664** | **~5058** | **~2606 linhas (33%)** |

---

## 🎓 Princípios de Limpeza

✅ **Keep**:
- Architecture & design decisions (ADRs)
- Setup & operational guides (DEVOPS, A11Y, PLUGIN_DEVELOPER)
- Quality gates & governance (PR_QUALITY)
- Team processes (WORKFLOW)

❌ **Remove**:
- One-time migration guides (after execution)
- Research duplicated in ADRs
- Status documents that become outdated

✏️ **Consolidate**:
- Research → INDEX.md com referências a ADRs
- Status → decision-log.md com timeline
- Overlapping processes → revisar, consolidar se necessário

---

## 🚀  Plan de Ação Proposto

### Opção A: Agressivo (Agora + Imediatamente Pós)
- Executar Tier 1 + 2 agora
- Tier 3 + 4 pós-migração
- Resultado: 33% redução de documentação

### Opção B: Conservador (Apenas Necessário Agora)
- Executar Tier 1 apenas (remover migration guide após uso)
- Tiers 2-4 como "nice-to-have" pós-migração
- Resultado: ~9% redução imediata, mais 30% pós

**Recomendação**: Opção A (você quer limpeza agora) + parallelizar research consolidation com prep de migração.

---

**Próxima ação**: Qual abordagem você prefere?
