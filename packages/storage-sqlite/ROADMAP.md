# Storage (SQLite) - Roadmap

**Current Version**: v0.0.1-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## Overview

**storage-sqlite** provides persistent local storage via SQLite WASM:

- **SQLite** (sql.js or wa-sqlite)
- **OPFS** (Origin Private File System for persistence)
- **JSON-LD** (native support for semantic data)

**Responsibilities**:

- CRUD operations (Create, Read, Update, Delete)
- JSON-LD storage and querying
- Schema migrations
- Transactions
- Backup/restore
- Query interface compatible with semantic graph

---

## Technical Decisions

### SQLite Engine Choice (Pending ADR-015)

**Options**:

1. **wa-sqlite** (Recommended)
   - Native OPFS support via `FileSystemSyncAccessHandle`
   - Smaller bundle (~80KB)
   - Better performance (direct file I/O)
   - Active maintenance

2. **sql.js** (Fallback)
   - Mature, battle-tested
   - Larger bundle (~700KB)
   - Memory-based (serialize to OPFS manually)
   - Works in older browsers

**Decision criteria**: Benchmark both with 100k inserts in OPFS, measure:

- Initial load time
- Write throughput
- Memory usage
- Browser compatibility

### Schema Design

**Primary table** (`nodes`):

```sql
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,           -- @id (IRI, e.g., "urn:matrix:contact-123")
  type TEXT NOT NULL,            -- @type (e.g., "Person", "Message")
  data TEXT NOT NULL,            -- Full JSON-LD node (validated)
  vault_id TEXT NOT NULL,        -- Owner vault (guest UUID or nostr pubkey)
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,            -- Soft delete (CRDT tombstone)
  CHECK (json_valid(data))       -- SQLite JSON validation
);

CREATE INDEX idx_nodes_type ON nodes(type);
CREATE INDEX idx_nodes_vault ON nodes(vault_id);
CREATE INDEX idx_nodes_updated ON nodes(updated_at);
CREATE INDEX idx_nodes_deleted ON nodes(deleted_at) WHERE deleted_at IS NULL;
```

**Full-text search** (FTS5):

```sql
CREATE VIRTUAL TABLE nodes_fts USING fts5(
  id UNINDEXED,
  type UNINDEXED,
  content,                       -- Extracted from JSON-LD (name, description, text)
  content=nodes,
  content_rowid=rowid
);
```

**Migrations table**:

```sql
CREATE TABLE migrations (
  version TEXT PRIMARY KEY,      -- e.g., "0.1.0-to-0.2.0"
  applied_at INTEGER NOT NULL DEFAULT (unixepoch()),
  description TEXT
);
```

### JSON-LD Storage Strategy

**Store as TEXT, not JSONB** (SQLite doesn't have JSONB):

- Use `json_*` functions for queries: `json_extract(data, '$.name')`
- Index common fields: `CREATE INDEX idx_name ON nodes((json_extract(data, '$.name')));`
- Trade-off: Slower than native JSONB (Postgres), but acceptable for client-side workload

**Example query**:

```sql
-- Find all Tasks with status "pending"
SELECT id, data FROM nodes
WHERE type = 'Action'
  AND json_extract(data, '$.actionStatus') = 'PotentialActionStatus';
```

### Transaction Strategy

**WAL mode enabled** (Write-Ahead Logging):

- Better concurrency (reads don't block writes)
- Crash recovery (atomic commits)
- Required for OPFS sync access

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;  -- Balance durability vs performance
```

**API wrapper**:

```typescript
async transaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T> {
  await this.exec('BEGIN IMMEDIATE');
  try {
    const result = await callback(this);
    await this.exec('COMMIT');
    return result;
  } catch (err) {
    await this.exec('ROLLBACK');
    throw err;
  }
}
```

### Migration System

**Version-based migrations** (not timestamp):

- Migrations named: `001_initial_schema.sql`, `002_add_vault_id.sql`
- Each migration is idempotent (can run twice safely)
- Migrations tracked in `migrations` table

**Example migration**:

```typescript
// migrations/002_add_vault_id.sql
ALTER TABLE nodes ADD COLUMN vault_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX idx_nodes_vault ON nodes(vault_id);
INSERT INTO migrations (version, description) 
VALUES ('0.2.0', 'Add vault_id for multi-vault support');
```

---

## v0.1.0 - Core Storage
**Scope**: SQLite WASM wrapper with OPFS persistence  
**Depends on**: kernel v0.1.0 (service registry)

### Pre-SDD Research

- [x] Validação #1: WebLLM feasibility (Completed)
- [ ] Validação #4: JSON-LD storage patterns
  - [ ] Test JSON1 extension performance
  - [ ] Test FTS5 for text search
  - [ ] Benchmark OPFS vs IndexedDB
  - [ ] Validate wa-sqlite vs sql.js

### SDD (Spec Driven)

**Goal**: Define storage API and SQLite integration  
**Gate**: Specs complete, peer reviewed, no TODOs

- [ ] ADR-015: SQLite engine choice (wa-sqlite vs sql.js)
- [ ] ADR-009: OPFS persistence strategy
- [ ] ADR-010: JSON-LD schema evolution
- [ ] Spec: Storage service interface
  - [ ] CRUD methods (insert, select, update, delete)
  - [ ] Transaction API
  - [ ] Query builder (optional)
  - [ ] Migration system
- [ ] Spec: JSON-LD storage schema
  - [ ] Entity table (id, type, data TEXT + JSON1)
  - [ ] Relationship table (subject, predicate, object)
  - [ ] Indexes (by type, by property)
  - [ ] Full-text search (FTS5)
- [ ] Spec: Lifecycle hooks
  - [ ] onInit (create tables, migrations)
  - [ ] onBackup (export DB)
  - [ ] onRestore (import DB)

### BDD (Behaviour Driven)

**Goal**: Write integration tests that describe expected behavior (FAILING)  
**Gate**: Tests written (🔴 RED), peer reviewed

- [ ] E2E: Kernel boots, storage service initializes
- [ ] E2E: Storage persists data across page reloads (OPFS)
- [ ] E2E: Insert JSON-LD entity, retrieve by ID
- [ ] E2E: Query entities by @type
- [ ] E2E: Update entity, verify changes persisted
- [ ] E2E: Delete entity, verify removed
- [ ] E2E: Transaction rollback on error
- [ ] E2E: Full-text search on entity properties
- [ ] Acceptance: Storage is reliable, persistent, and queryable

### TDD (Test Driven)

**Goal**: Write unit tests for contracts (FAILING)  
**Gate**: Tests written (🔴 RED), coverage ≥80%

- [ ] Unit: CRUD operation contracts
- [ ] Unit: Transaction management
- [ ] Unit: Query builder (if implemented)
- [ ] Unit: Migration system
- [ ] Unit: JSON-LD validation
- [ ] Coverage: >80%

### DDD (Domain Implementation)

**Goal**: Implement code until all tests PASS  
**Gate**: Tests GREEN (🟢), coverage met, changeset created

- [ ] Domain: StorageService class
- [ ] Domain: CRUD methods
- [ ] Domain: Transaction API
- [ ] Domain: Query interface
- [ ] Domain: Migration system
- [ ] Infra: SQLite WASM integration (wa-sqlite or sql.js)
- [ ] Infra: OPFS backend
- [ ] Infra: JSON1 extension support
- [ ] Infra: FTS5 full-text search

### CHANGELOG

```
## [0.1.0] - YYYY-MM-DD
### Added
- Core StorageService with CRUD operations
- SQLite WASM integration
- OPFS persistence layer
- JSON-LD native storage
- Transaction support
- Full-text search (FTS5)
- Schema migration system
```

---

## v0.2.0 - Query Optimization
**Scope**: Advanced querying and indexing  
**Depends on**: v0.1.0 stable

### SDD (Spec Driven)

- [ ] Spec: Query optimization patterns
  - [ ] Index strategy (when to index)
  - [ ] Query planner hints
  - [ ] Prepared statements
- [ ] Spec: Advanced queries
  - [ ] Graph traversal (relationships)
  - [ ] Aggregations
  - [ ] Joins (entity + relationships)

### BDD (Behaviour Driven)

- [ ] E2E: Query 10,000 entities in <50ms
- [ ] E2E: Full-text search across 50,000 entities in <100ms
- [ ] E2E: Graph traversal (2 hops) in <100ms
- [ ] Acceptance: Storage performance is acceptable

### TDD (Test Driven)

- [ ] Unit: Index creation logic
- [ ] Unit: Query optimizer
- [ ] Unit: Prepared statement caching
- [ ] Benchmark: CRUD operations (<10ms p95)
- [ ] Coverage: >80%

### DDD (Domain Implementation)

- [ ] Domain: Query optimizer
- [ ] Domain: Index manager
- [ ] Domain: Graph traversal methods
- [ ] Polish: Performance tuning
- [ ] Docs: Query best practices

### CHANGELOG

```
## [0.2.0] - YYYY-MM-DD
### Added
- Query optimization with smart indexing
- Graph traversal methods
- Aggregation support
- Performance benchmarks

### Changed
- Query performance improved (2-5x faster)
```

---

## v0.3.0 - Backup & Import/Export
**Scope**: Data portability  
**Depends on**: sync-crdt v0.1.0 (for export format)

### SDD (Spec Driven)

- [ ] Spec: Backup/restore API
  - [ ] Export database (SQLite file or JSON)
  - [ ] Import database
  - [ ] Incremental backup
- [ ] Spec: Export formats
  - [ ] JSON-LD dump (human-readable)
  - [ ] SQLite binary (fast, compact)
  - [ ] ZIP archive (with metadata)

### BDD (Behaviour Driven)

- [ ] E2E: User exports entire database
- [ ] E2E: User imports database, all data restored
- [ ] E2E: Incremental backup (only changed data)
- [ ] Acceptance: User can backup/restore Refarm data

### TDD (Test Driven)

- [ ] Unit: Export logic (SQLite → JSON-LD)
- [ ] Unit: Import logic (JSON-LD → SQLite)
- [ ] Unit: Incremental diff calculation
- [ ] Coverage: >80%

### DDD (Domain Implementation)

- [ ] Domain: Backup service
- [ ] Domain: Export methods (JSON + SQLite)
- [ ] Domain: Import methods
- [ ] Infra: ZIP compression
- [ ] Docs: Backup/restore guide

### CHANGELOG

```
## [0.3.0] - YYYY-MM-DD
### Added
- Database backup/restore
- Export to JSON-LD or SQLite file
- Import from JSON-LD or SQLite
- Incremental backup support
```

---

## v1.0.0 - Production Ready
**Scope**: Polish, performance, reliability  
**Depends on**: All features stable

### Quality Criteria

- [ ] CRUD operations <10ms (p95)
- [ ] Full-text search <100ms (50k entities, p95)
- [ ] Database size efficient (JSON compression)
- [ ] No data loss on crash (WAL mode)
- [ ] Migrations tested (v0.1 → v1.0)
- [ ] Backup/restore tested (1GB+ databases)

### SDD (Spec Driven)

- [ ] Spec: Error handling and recovery
  - [ ] Corruption detection
  - [ ] Auto-repair (from backup)
  - [ ] Graceful degradation
- [ ] Spec: Performance monitoring
  - [ ] Query duration metrics
  - [ ] Database size metrics
  - [ ] Cache hit rates

### BDD (Behaviour Driven)

- [ ] E2E: Storage handles 100k entities without performance degradation
- [ ] E2E: Storage recovers from simulated crash (WAL integrity)
- [ ] E2E: Migrations work from v0.1 → v1.0
- [ ] Acceptance: Storage is production-grade

### TDD (Test Driven)

- [ ] Unit: Error recovery logic
- [ ] Unit: Corruption detection
- [ ] Benchmark: All quality criteria met
- [ ] Stress test: 1M entities, 10MB JSON
- [ ] Coverage: >85%

### DDD (Domain Implementation)

- [ ] Polish: Error handling and recovery
- [ ] Polish: Performance tuning (indexes, cache)
- [ ] Polish: Monitoring integration (observability)
- [ ] Docs: API reference complete
- [ ] Docs: Performance tuning guide
- [ ] Docs: Migration guide

### CHANGELOG

```
## [1.0.0] - YYYY-MM-DD
### Changed
- Performance optimizations (indexing, caching)
- Enhanced error handling and recovery
- Improved observability integration

### Fixed
- [All known data integrity issues addressed]
```

---

## Notes

- **Engine Choice**: wa-sqlite preferred (better OPFS support, smaller bundle)
- **Schema**: JSON-LD stored as TEXT (SQLite JSON1 extension for queries)
- **Persistence**: OPFS is required (fallback to IndexedDB for unsupported browsers)
- **Migrations**: Use a versioning system (e.g., `user_version` pragma)
- **Testing**: Focus on data integrity and crash recovery
- **Performance**: Target <10ms for CRUD, <100ms for full-text search
