# Refarm - Estado Atual e Próximos Passos

**Data**: 2026-03-06  
**Fase**: Semana 0 (Preparação Pré-Sprint 1)  
**Status**: 🟡 Quase pronto (2 validações técnicas pendentes)

---

## O Que Foi Feito Hoje

### 1. Diagnóstico e Consolidação Documental

✅ **Mapeamento de inconsistências**:
- Identificado drift entre documentos de prontidão
- Localizado gap entre documentação de CI/testes e realidade dos scripts
- Confirmado que os únicos bloqueadores reais são validações de browser (WASM + OPFS)

✅ **Fonte única de verdade estabelecida**:
- `docs/pre-sprint-checklist.md` agora é referência canônica de prontidão Semana 0
- `roadmaps/MAIN.md` sincronizado com status real
- `docs/decision-log.md` atualizado com decisões recentes

### 2. Baseline de Testes de Fumaça

✅ **Smoke tests criados nos workspaces críticos**:
- `apps/kernel/test/smoke.test.ts`: Normalização de nós soberanos + ciclo de vida de plugins
- `packages/storage-sqlite/test/smoke.test.ts`: Sistema de migrações idempotentes
- `packages/sync-crdt/test/smoke.test.ts`: Merge de clocks vetoriais + dispatch/receive de operações

✅ **Validação executada**:
- `npm run test:unit`: 5 testes passando (kernel: 2, storage: 1, sync: 2)
- `npm run lint`: Sem erros em todos os pacotes
- Verificação de erros VS Code: Sem problemas nos arquivos editados

### 3. Alinhamento de Gates de Qualidade

✅ **Confirmado que a esteira existe e funciona**:
- Scripts root: `test:unit`, `test:integration`, `test:e2e` ✓
- Turbo tasks alinhados com workspaces ✓
- Workflow de changeset configurado (`.github/workflows/validate-changeset.yml`) ✓
- CI pipeline estruturado (`.github/workflows/test.yml`) ✓

### 4. Documentação de Próximos Passos

✅ **Gate final estabelecido**:
- Checklist executável para os 2 bloqueadores
- Matriz de decisão (GO/PAUSE/PIVOT)
- Instruções de commit e rollback
- Critérios claros de sucesso

---

## O Que Falta (Bloqueadores)

### Bloqueador 1: WASM Browser Runtime ⚠️

**O que é**: Validar que plugin Rust compilado roda no browser e consegue chamar o host (kernel-bridge).

**Evidência atual**:
- ✅ Compilação OK (`cargo component build --release` funciona)
- ⚠️ Runtime no browser não testado ainda

**Como executar**:
1. `cd validations/wasm-plugin/host`
2. `npm install && npm run dev`
3. Abrir `http://localhost:5173`
4. Clicar nos 5 botões e confirmar logs no console

**Tempo estimado**: 30 minutos

**Critério de sucesso**: Todos os botões funcionam, load time < 100ms, tamanho WASM < 500KB

**Se falhar**: Pesquisar alternativas (Native Messaging, Extension API, Web Workers sem WASM)

---

### Bloqueador 2: OPFS Browser Validation ⚠️

**O que é**: Confirmar que wa-sqlite com OPFS funciona bem no browser (benchmark atual foi só Node in-memory).

**Evidência atual**:
- ✅ Benchmark Node executado (wa-sqlite vs sql.js)
- ✅ ADR-015 escrito com decisão provisória (wa-sqlite)
- ⚠️ Validação OPFS no browser pendente

**Como executar** (opção pragmática):
1. Aceitar decisão provisória e documentar assunção
2. Adicionar validação OPFS como gate pré-BDD do Sprint 1
3. Se testar agora: criar harness HTML simples com wa-sqlite + OPFS

**Tempo estimado**: 1-2 horas (se testar agora) ou 0 min (se deferir para Sprint 1)

**Critério de sucesso**: 10k inserts < 5s, arquivo persiste no OPFS após reload

**Se falhar**: Considerar DuckDB WASM, sql.js com IndexedDB, ou design híbrido

---

## Matriz de Decisão

| WASM | OPFS | Ação |
|------|------|------|
| ✅ | ✅ | **GO**: Iniciar Sprint 1 SDD imediatamente |
| ✅ | ⚠️ Deferir | **GO com ressalva**: Adicionar OPFS como gate pré-BDD |
| ✅ | ❌ | **PAUSA**: Pesquisar alternativas SQLite (1 semana) |
| ❌ | * | **PIVOT GRANDE**: Redesign de arquitetura de plugins (2+ semanas) |

---

## Recomendação Pragmática (Solo Maintainer)

**Opção A - Validar Tudo Agora** (recomendado se tiver 2-3h livres):
1. Executar validação WASM browser (30 min)
2. Executar validação OPFS browser (1-2h)
3. Se ambas passarem: commit + start Sprint 1 SDD
4. Se alguma falhar: pesquisar alternativas antes de prosseguir

**Opção B - Validar WASM, Deferir OPFS** (recomendado se quiser começar logo):
1. Executar validação WASM browser (30 min)
2. Se passar: aceitar OPFS como provisório, documentar assunção
3. Adicionar validação OPFS como gate do Sprint 1 (antes de BDD)
4. Commit + start Sprint 1 SDD

**Opção C - Start com Risco Conhecido** (não recomendado, mas possível):
1. Aceitar ambas validações como provisórias
2. Documentar assunções e riscos em pre-sprint-checklist.md
3. Adicionar ambas como gates pré-BDD do Sprint 1
4. Start Sprint 1 SDD focado em specs (baixo risco de retrabalho se specs forem bem escritas)

---

## Próximos Passos Imediatos

### Executar Validações

```bash
# 1. WASM browser (obrigatório, ~30 min)
cd validations/wasm-plugin/host
npm install
cp ../hello-world/target/wasm32-wasip1/release/hello_world_plugin.wasm public/
npm run dev
# Abrir http://localhost:5173 → testar 5 botões

# 2. OPFS browser (opcional, ~1-2h ou deferir)
# Se testar: adicionar harness HTML em validations/sqlite-benchmark/public/
# Se deferir: aceitar ADR-015 provisório, adicionar ao Sprint 1 pre-BDD gate
```

### Após Validações (Se GO)

```bash
# 1. Marcar validações completas/deferidas
# - docs/pre-sprint-checklist.md (checkboxes)
# - specs/ADRs/ADR-015-sqlite-engine-decision.md (status)
# - roadmaps/MAIN.md (Pre-Sprint → ✅ Complete)

# 2. Commit
git add -A
git commit -m "chore: Semana 0 complete - validations passed"

# 3. Começar Sprint 1 SDD
# Escrever specs: Storage, Sync, Kernel interfaces (docs/WORKFLOW.md)
```

### Se Encontrar Bloqueador

```bash
# 1. Capturar evidência (screenshot, logs)
# 2. Criar issue com tag `blocker` + `pre-sprint`
# 3. Pesquisar alternativas:
#    - WASM fail → Native Messaging, Extension API, Web Workers
#    - OPFS fail → DuckDB WASM, sql.js + IndexedDB
# 4. Atualizar docs/decision-log.md com novo status
# 5. Ajustar roadmaps/MAIN.md com novo timeline
```

---

## Arquivos Modificados/Criados

**Novos**:
- `apps/kernel/test/smoke.test.ts` (2 testes)
- `packages/storage-sqlite/test/smoke.test.ts` (1 teste)
- `packages/sync-crdt/test/smoke.test.ts` (2 testes)

**Atualizados**:
- `docs/pre-sprint-checklist.md` (fonte de verdade, CI status, smoke tests)
- `roadmaps/MAIN.md` (status alinhado, ADRs marcados completos)
- `docs/decision-log.md` (quality gate baseline registrado)
- `docs/research/wasm-validation.md` (status → "in progress")

---

## Hierarquia Documental

| Documento | Propósito |
|-----------|-----------|
| `docs/pre-sprint-checklist.md` | **Fonte de verdade** - Checklist completo Semana 0 |
| `roadmaps/MAIN.md` | Visão de alto nível dos milestones |
| `docs/decision-log.md` | Log de decisões técnicas |
| `docs/ESTADO_ATUAL.md` | ⭐ Este arquivo - resumo executivo |
| `specs/ADRs/ADR-015-*.md` | ⚠️ SQLite decision (provisório, pending OPFS) |
| `docs/research/wasm-validation.md` | ⚠️ WASM validation (Phase 2-4 pending) |

---

## Resumo Executivo

**Você está a 30 minutos (WASM) ou 2-3 horas (WASM + OPFS) de poder começar o Sprint 1.**

**O que foi conquistado hoje**:
- Documentação alinhada e confiável
- Baseline de testes funcionando (não mais "verde vazio")
- Gate de qualidade validado (lint, type-check, test:unit operacionais)
- Roadmap com critérios objetivos de prontidão

**O que ainda separa você do Sprint 1**:
- 1 validação técnica obrigatória (WASM browser)
- 1 validação técnica opcional mas recomendada (OPFS browser)

**Decisão sugerida**: Execute validação WASM agora (30 min), avalie resultado, e decida sobre OPFS baseado no tempo disponível e apetite a risco.

---

## Referências

- 📝 **Checklist completo**: [`pre-sprint-checklist.md`](pre-sprint-checklist.md)
- 🗺️ **Roadmap**: [`roadmaps/MAIN.md`](../roadmaps/MAIN.md)
- 🧪 **Validação WASM**: [`research/wasm-validation.md`](research/wasm-validation.md)
- 🗄️ **SQLite ADR**: [`specs/ADRs/ADR-015-sqlite-engine-decision.md`](../specs/ADRs/ADR-015-sqlite-engine-decision.md)
- 🔄 **Workflow**: [`WORKFLOW.md`](WORKFLOW.md)
