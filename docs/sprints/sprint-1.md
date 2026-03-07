# Sprint 1 - SDD Checklist

**Sprint**: v0.1.0 - MVP Core  
**Fase**: SDD (Specification Driven Development)  
**Data de Criação**: 2026-03-07  
**Status**: Preparação

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

- [ ] **WASM Runtime Validation** (validations/wasm-plugin/)
  - [ ] Plugin compila para WASM
  - [ ] Carrega no browser (<100ms)
  - [ ] Executa WIT interface
  - [ ] Tamanho <500KB
  - **Status**: Compilação OK, runtime pending
  - **Evidência**: `validations/wasm-plugin/host/`

- [ ] **SQLite + OPFS Validation** (opcional - pode ser gate pré-BDD)
  - [ ] wa-sqlite funciona com OPFS no browser
  - [ ] Performance: 10k inserts <5s
  - [ ] Arquivo persiste após reload
  - **Status**: Benchmark Node OK, browser pending
  - **Evidência**: `validations/sqlite-benchmark/results.md`

---

## SDD Phase: Specs a Criar

### 1. Session Management (CRÍTICO)

**Arquivo**: `specs/features/session-management.md`

**Conteúdo esperado**:
- Guest session lifecycle (create, upgrade, destroy)
- Session state machine (transient → persistent → permanent)
- VaultId generation strategy (UUID vs Nostr pubkey)
- Session storage (localStorage + memory)
- Error recovery (corrupted session, quota exceeded)

**Interfaces a Especificar**:
```typescript
interface SessionManager {
  createGuestSession(tier: StorageTier): Promise<Session>
  upgradeToPermament(nostrKey: string): Promise<void>
  getCurrentSession(): Session | null
  destroySession(): Promise<void>
}

type StorageTier = 'ephemeral' | 'persistent' | 'synced'
```

**Aceita como completo quando**:
- [ ] API completa documentada
- [ ] State transitions diagramados
- [ ] Error cases listados
- [ ] Sem TODOs ou TBDs

---

### 2. Storage Tiers (CRÍTICO)

**Arquivo**: `specs/features/storage-tiers.md`

**Conteúdo esperado**:
- Definição dos 3 tiers (ephemeral/persistent/synced)
- Quando usar cada tier
- Behavior differences por tier
- Migration path entre tiers
- Quota management strategy

**Tabela de Decisão**:
| Tier | Persistence | Survives Reload | Syncs Between Devices | Use Case |
|------|------------|-----------------|----------------------|----------|
| ephemeral | Memory | ❌ | ❌ | Quick demos, privacy mode |
| persistent | OPFS | ✅ | ❌ | Single-device guest |
| synced | OPFS + CRDT | ✅ | ✅ | Multi-device guest |

**Aceita como completo quando**:
- [ ] Decision matrix completa
- [ ] Interfaces especificadas
- [ ] Migration paths documentados
- [ ] Sem TODOs ou TBDs

---

### 3. Guest to Permanent Migration (CRÍTICO)

**Arquivo**: `specs/features/guest-to-permanent-migration.md`

**Conteúdo esperado**:
- Trigger conditions (user click "Sign up")
- Data ownership rewrite (guest UUID → Nostr pubkey)
- Storage persistence (keep OPFS, update vault metadata)
- CRDT state transfer
- Rollback strategy se falhar

**Sequência Esperada**:
```
1. User clicks "Upgrade to permanent account"
2. Generate/import Nostr keypair
3. Update all nodes: vault_id = guest_uuid → nostr_pubkey
4. Update vault metadata in OPFS
5. Update CRDT document ownership
6. Persist identity in identity-nostr package
7. Success: Session now permanent
```

**Aceita como completo quando**:
- [ ] Sequência completa documentada
- [ ] Failure modes identificados
- [ ] Rollback strategy definida
- [ ] Sem TODOs ou TBDs

---

### 4. Plugin Lifecycle (IMPORTANTE)

**Arquivo**: `specs/features/plugin-lifecycle.md`

**Conteúdo esperado**:
- Plugin loading sequence (fetch → verify → instantiate)
- Plugin sandbox initialization
- WIT interface binding
- Plugin unload/reload
- Error isolation (plugin crash não quebra kernel)

**State Machine**:
```
NOT_LOADED → LOADING → LOADED → RUNNING → STOPPED → ERROR
```

**Aceita como completo quando**:
- [ ] State machine completo
- [ ] Loading sequence documentado
- [ ] Error boundaries definidos
- [ ] Sem TODOs ou TBDs

---

### 5. Storage Schema & Migrations (IMPORTANTE)

**Arquivo**: `specs/features/storage-schema.md`

**Conteúdo esperado**:
- SQLite schema completo (tables, indexes, constraints)
- Migration system design
- JSON-LD validation strategy
- FTS5 configuration
- Backup/restore format

**Schema Base**:
```sql
-- Já definido em packages/storage-sqlite/ROADMAP.md
-- Copiar e refinar aqui para referência SDD
```

**Aceita como completo quando**:
- [ ] Schema SQL completo
- [ ] Migration strategy documentado
- [ ] Validation rules definidos
- [ ] Sem TODOs ou TBDs

---

## Quality Gates

### Gate 1: Pré-Requisitos Completos ✅

- [ ] WASM validation executada (resultado: GO/PIVOT)
- [ ] SQLite decision finalizada (ou deferida com justificativa)
- [ ] ADRs atualizados com resultados

### Gate 2: Specs Completas ✅

- [ ] Todas as 5 specs criadas
- [ ] Peer review solicitado (opcional se solo dev)
- [ ] Nenhum TODO/TBD em seções críticas
- [ ] Interfaces TypeScript documentadas
- [ ] Diagramas criados onde necessário

### Gate 3: Pronto para BDD ✅

- [ ] Specs aceitas
- [ ] Integration tests podem ser escritos com base nas specs
- [ ] Contratos claros entre componentes

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

#### Domain Layer (apps/kernel)

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

#### UI Updates (apps/studio)

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
