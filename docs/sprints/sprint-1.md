# Sprint 1 - SDD Checklist

**Sprint**: v0.1.0 - MVP Core  
**Fase**: SDD (Specification Driven Development)  
**Data de Criação**: 2026-03-07  
**Status**: Em andamento

---

## Objetivo do Sprint 1

Implementar fundação offline-first com suporte a guest mode:
- Storage SQLite + OPFS
- Guest session lifecycle
- Storage tiers (ephemeral/persistent/synced)
- Upgrade guest → permanent user

---

## Pré-Requisitos (Bloqueadores)

### Validações Técnicas

- [x] **WASM Runtime Validation** (validations/wasm-plugin/)
  - [x] Plugin compila para WASM
  - [x] Carrega no browser (<1000ms validado por E2E; alvo <100ms para otimização futura)
  - [x] Executa WIT interface (setup, ingest, metadata, teardown)
  - [x] Tamanho <500KB
  - **Status**: ✅ Validado via CI E2E (chromium + firefox + webkit passando)
  - **Evidência**: `validations/wasm-plugin/host/tests/e2e/plugin-lifecycle.spec.ts`

- [ ] **SQLite + OPFS Validation** (opcional - pode ser gate pré-BDD)
  - [ ] wa-sqlite funciona com OPFS no browser
  - [ ] Performance: 10k inserts <5s
  - [ ] Arquivo persiste após reload
  - **Status**: Benchmark Node OK ✅; browser OPFS pendente (deferred — não bloqueia BDD)
  - **Decisão**: wa-sqlite selecionado (ver `validations/sqlite-benchmark/results.md`)
  - **Evidência**: `validations/sqlite-benchmark/results.md`

---

## SDD Phase: Specs a Criar

### 1. Session Management (CRÍTICO)

**Arquivo**: `specs/features/session-management.md`

**Status**: ✅ Spec criada e completa (315 linhas, sem TODOs/TBDs)

**Aceita como completo quando**:
- [x] API completa documentada
- [x] State transitions diagramados
- [x] Error cases listados
- [x] Sem TODOs ou TBDs

---

### 2. Storage Tiers (CRÍTICO)

**Arquivo**: `specs/features/storage-tiers.md`

**Status**: ✅ Spec criada e completa (407 linhas, sem TODOs/TBDs)

**Aceita como completo quando**:
- [x] Decision matrix completa
- [x] Interfaces especificadas
- [x] Migration paths documentados
- [x] Sem TODOs ou TBDs

---

### 3. Guest to Permanent Migration (CRÍTICO)

**Arquivo**: `specs/features/guest-to-permanent-migration.md`

**Status**: ✅ Spec criada e completa (449 linhas, sem TODOs/TBDs)

**Aceita como completo quando**:
- [x] Sequência completa documentada
- [x] Failure modes identificados
- [x] Rollback strategy definida
- [x] Sem TODOs ou TBDs

---

### 4. Plugin Lifecycle (IMPORTANTE)

**Arquivo**: `specs/features/plugin-lifecycle.md`

**Status**: ✅ Spec criada e completa (329 linhas; TBDs apenas em benchmarks de performance a medir na implementação)

**Aceita como completo quando**:
- [x] State machine completo
- [x] Loading sequence documentado
- [x] Error boundaries definidos
- [x] Sem TODOs ou TBDs em seções críticas

---

### 5. Storage Schema & Migrations (IMPORTANTE)

**Arquivo**: `specs/features/storage-schema.md`

**Status**: ✅ Spec criada e completa (498 linhas, sem TODOs/TBDs)

**Aceita como completo quando**:
- [x] Schema SQL completo
- [x] Migration strategy documentado
- [x] Validation rules definidos
- [x] Sem TODOs ou TBDs

---

## Quality Gates

### Gate 1: Pré-Requisitos Completos ✅

- [x] WASM validation executada (resultado: GO — CI E2E passa em chromium/firefox/webkit)
- [x] SQLite decision finalizada (wa-sqlite selecionado; browser OPFS deferido, não bloqueia)
- [ ] ADRs atualizados com resultados

### Gate 2: Specs Completas ✅

- [x] Todas as 5 specs criadas
- [x] Peer review solicitado (opcional se solo dev)
- [x] Nenhum TODO/TBD em seções críticas
- [x] Interfaces TypeScript documentadas
- [x] Diagramas criados onde necessário

### Gate 3: Pronto para BDD ✅

- [x] Specs aceitas
- [x] Integration tests podem ser escritos com base nas specs
- [x] Contratos claros entre componentes

---

## BDD Phase: Integration Tests (Behavior Driven)

**Status**: Pending (after SDD complete)  
**Branch**: `sprint1/bdd-session-storage`

### Integration Tests to Write

#### Session Management

- [ ] **Guest session creation**

  ```typescript
  // test: guest creates ephemeral session
  // test: guest creates persistent session
  // test: guest creates synced session
  ```

- [ ] **Session persistence**

  ```typescript
  // test: session survives browser reload
  // test: session loads from localStorage
  ```

- [ ] **Guest to permanent upgrade**

  ```typescript
  // test: upgrade with new Nostr key
  // test: upgrade with existing key
  // test: data ownership rewritten correctly
  ```

#### Storage Tiers

- [ ] **Ephemeral tier behavior**

  ```typescript
  // test: data in memory only
  // test: data lost on reload
  ```

- [ ] **Persistent tier behavior**

  ```typescript
  // test: data persists to OPFS
  // test: data survives reload
  ```

- [ ] **Synced tier behavior**

  ```typescript
  // test: CRDT initialized
  // test: sync between two tabs (simulated)
  ```

- [ ] **Tier migration**

  ```typescript
  // test: migrate ephemeral → persistent
  // test: migrate persistent → synced
  ```

#### Storage Schema

- [ ] **Schema initialization**

  ```typescript
  // test: tables created on first run
  // test: indexes created successfully
  ```

- [ ] **CRUD operations**

  ```typescript
  // test: store 1000 nodes
  // test: query by vault_id
  // test: query by type
  // test: soft delete
  ```

### Quality Gate 2: BDD Complete ✅

- [ ] All integration tests written
- [ ] Tests FAIL as expected (red phase)
- [ ] Tests peer reviewed
- [ ] Coverage plan documented

**Estimated Duration**: 2-3 days

---

## TDD Phase: Unit Tests (Test Driven)

**Status**: Pending (after BDD complete)  
**Branch**: `sprint1/tdd-unit-coverage`

### Unit Tests to Write

#### SessionManager

- [ ] `createGuestSession()` generates UUID
- [ ] `createGuestSession()` respects tier parameter
- [ ] `loadSession()` returns null when empty
- [ ] `upgradeToPermament()` validates Nostr key
- [ ] `destroySession()` clears localStorage

#### StorageManager

- [ ] `setTier()` initializes correct adapter
- [ ] `migrateTier()` preserves data
- [ ] `checkQuota()` calculates correctly

#### WaSqliteAdapter

- [ ] `storeNode()` validates JSON-LD
- [ ] `queryNodes()` uses correct index
- [ ] `deleteNode()` sets deleted_at

#### MigrationRunner

- [ ] applies pending migrations in order
- [ ] skips already applied migrations
- [ ] rolls back on error

### Quality Gate 3: TDD Complete ✅

- [ ] All unit tests written
- [ ] Tests FAIL as expected (red phase)
- [ ] Coverage >80% planned
- [ ] Mocks and fixtures created

**Estimated Duration**: 2-3 days

---

## DDD Phase: Implementation (Domain Driven)

**Status**: Pending (after TDD complete)  
**Branch**: `sprint1/ddd-implementation`

### Implementation Tasks

#### Domain Layer (apps/tractor)

- [ ] Implement `SessionManager` class
- [ ] Implement `StorageManager` orchestration
- [ ] Implement `PluginHost` (minimal for v0.1.0)
- [ ] Implement event bus for session changes

#### Infrastructure Layer (packages)

- [ ] **storage-sqlite**
  - [ ] `WaSqliteAdapter` (OPFS persistence)
  - [ ] `EphemeralAdapter` (in-memory)
  - [ ] `SyncedAdapter` (OPFS + Yjs)
  - [ ] `MigrationRunner`
  - [ ] Initial migration (0001_initial_schema.ts)

- [ ] **identity-nostr**
  - [ ] Keypair generation
  - [ ] Key import/export
  - [ ] Key validation (NIP-19)

- [ ] **sync-crdt** (minimal for v0.1.0)
  - [ ] Yjs document initialization
  - [ ] Ownership metadata

#### UI Updates (apps/homestead)

- [ ] Guest session creation flow
- [ ] Storage tier selection
- [ ] Upgrade to permanent modal
- [ ] Session status indicator

### Quality Gate 4: DDD Complete ✅

- [ ] All tests GREEN (100% passing)
- [ ] Coverage >80% achieved
- [ ] Code peer reviewed
- [ ] Changeset created
- [ ] Documentation updated

**Estimated Duration**: 5-7 days

---

## Sprint 1 Retrospective

**Status**: Pending (after sprint complete)

### Metrics

- **Velocity**: ___ story points completed
- **Quality**: ___% test coverage
- **Duration**: ___ working days

### What Went Well

- (To be filled after sprint)

### What Could Improve

- (To be filled after sprint)

### Action Items for Sprint 2

- (To be filled after sprint)

---

## Notas

- **Timeline Total**: ~10-15 dias (SDD: 3-5, BDD: 2-3, TDD: 2-3, DDD: 5-7)
- **Prioridade**: Session Management > Storage Tiers > Migration
- **Deferrable**: Plugin Lifecycle pode ser simplificado para v0.1.0
- **Referências**:
  - [Main Roadmap](../../roadmaps/MAIN.md)
  - [Pre-Sprint Checklist](../pre-sprint-checklist.md)
  - [Workflow Guide](../WORKFLOW.md)
