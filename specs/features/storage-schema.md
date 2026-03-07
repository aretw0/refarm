# Feature: Storage Schema & Migrations

**Status**: Draft  
**Version**: v0.1.0  
**Owner**: Core Team

---

## Summary

Storage Schema defines the SQLite database structure for persisting JSON-LD nodes in OPFS, including tables, indexes, constraints, and a robust migration system for schema evolution. This ensures data integrity, query performance, and forward compatibility as Refarm evolves.

---

## User Stories

### Story 1: Data Persistence

**As a** Refarm user  
**I want** my data stored reliably in a structured format  
**So that** I can query and retrieve it efficiently

### Story 2: Schema Evolution

**As a** user upgrading Refarm  
**I want** my existing data to migrate automatically  
**So that** I don't lose anything when the schema changes

### Story 3: Query Performance

**As a** user with 100k+ nodes  
**I want** queries to be fast (<100ms)  
**So that** the UI remains responsive

### Story 4: Data Integrity

**As a** user storing important data  
**I want** the database to prevent corruption  
**So that** I can trust the system with my information

---

## Acceptance Criteria

### AC1: Schema Initialization

1. **Given** first time opening Refarm  
   **When** storage initializes  
   **Then** schema is created
   - Tables created (nodes, migrations, vault_metadata)
   - Indexes created
   - Constraints enforced
   - Version recorded

### AC2: Node Storage

2. **Given** a valid JSON-LD node  
   **When** storeNode() is called  
   **Then** node is persisted
   - JSON validated before insert
   - Timestamps added automatically
   - Duplicate IDs handled (REPLACE or error)
   - Transaction committed

### AC3: Query Optimization

3. **Given** vault with 100k nodes  
   **When** query filters by type  
   **Then** results return in <50ms
   - Index used (idx_nodes_type)
   - No full table scan
   - Limit applied correctly

### AC4: Schema Migration

4. **Given** new Refarm version with schema changes  
   **When** app opens existing database  
   **Then** migrations run automatically
   - Detect current version
   - Apply pending migrations in order
   - Idempotent (safe to run multiple times)
   - Rollback on error

### AC5: Soft Delete

5. **Given** user deletes a node  
   **When** deleteNode() is called  
   **Then** node is soft-deleted
   - deleted_at timestamp set
   - Node kept for CRDT tombstone
   - Excluded from normal queries
   - Can be permanently purged later

---

## Technical Approach

### Core Schema (v0.1.0)

```sql
-- Nodes table: stores all JSON-LD entities
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,                -- @id (IRI, e.g., "urn:matrix:msg-123")
  type TEXT NOT NULL,                 -- @type (e.g., "Person", "Note")
  vault_id TEXT NOT NULL,             -- Owner (guest UUID or Nostr pubkey)
  data TEXT NOT NULL,                 -- Full JSON-LD node (serialized)
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,                 -- Soft delete timestamp (null = active)
  version INTEGER NOT NULL DEFAULT 0, -- CRDT version for conflict resolution
  
  -- Constraints
  CHECK (json_valid(data))            -- Ensure data is valid JSON
);

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_nodes_vault 
  ON nodes(vault_id) 
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_nodes_type 
  ON nodes(type) 
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_nodes_updated 
  ON nodes(updated_at DESC) 
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_nodes_deleted 
  ON nodes(deleted_at) 
  WHERE deleted_at IS NOT NULL;

-- Vault metadata table
CREATE TABLE IF NOT EXISTS vault_metadata (
  vault_id TEXT PRIMARY KEY,
  name TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  storage_tier TEXT NOT NULL DEFAULT 'ephemeral',
  sync_code TEXT,                     -- For multi-device sync
  total_nodes INTEGER DEFAULT 0,
  last_sync_at INTEGER,
  
  CHECK (storage_tier IN ('ephemeral', 'persistent', 'synced'))
);

-- Migrations table: tracks schema version
CREATE TABLE IF NOT EXISTS migrations (
  version TEXT PRIMARY KEY,           -- e.g., "0.1.0"
  applied_at INTEGER NOT NULL DEFAULT (unixepoch()),
  description TEXT,
  checksum TEXT                       -- SHA-256 of migration SQL
);

-- Full-text search (Phase 2 - v0.2.0+)
-- Deferred to avoid complexity in MVP
-- CREATE VIRTUAL TABLE nodes_fts USING fts5(
--   id UNINDEXED,
--   type UNINDEXED,
--   content,
--   content=nodes,
--   content_rowid=rowid
-- );
```

### Migration System Design

#### Migration File Format

```typescript
// migrations/0001_initial_schema.ts
export const migration = {
  version: '0.1.0',
  description: 'Initial schema with nodes, vault_metadata, migrations',
  checksum: 'sha256-abc123...',
  
  async up(db: Database): Promise<void> {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (...);
      CREATE INDEX IF NOT EXISTS idx_nodes_vault ON nodes(vault_id);
      -- ...
    `);
  },
  
  async down(db: Database): Promise<void> {
    // Rollback logic (optional for v0.1.0)
    await db.exec(`DROP TABLE IF EXISTS nodes;`);
  }
};
```

#### Migration Runner

```typescript
export class MigrationRunner {
  async migrate(db: Database): Promise<void> {
    const currentVersion = await this.getCurrentVersion(db);
    const pendingMigrations = this.getPendingMigrations(currentVersion);
    
    for (const migration of pendingMigrations) {
      console.log(`Applying migration: ${migration.version}`);
      
      await db.exec('BEGIN TRANSACTION');
      try {
        await migration.up(db);
        await this.recordMigration(db, migration);
        await db.exec('COMMIT');
      } catch (error) {
        await db.exec('ROLLBACK');
        throw new Error(`Migration ${migration.version} failed: ${error}`);
      }
    }
  }
  
  private async getCurrentVersion(db: Database): Promise<string> {
    const result = await db.exec(
      'SELECT version FROM migrations ORDER BY applied_at DESC LIMIT 1'
    );
    return result[0]?.values[0]?.[0] || '0.0.0';
  }
}
```

### Data Flow

```
User Action
    │
    ▼
storeNode(jsonLd)
    │
    ├─ Validate JSON-LD schema
    ├─ Generate @id if missing
    ├─ Extract type
    ├─ Serialize to JSON string
    │
    ▼
INSERT OR REPLACE INTO nodes (id, type, vault_id, data, ...)
    │
    ▼
SQLite writes to OPFS
    │
    ▼
Success (return node ID)
```

---

## API/Interface

```typescript
/**
 * Storage adapter interface (implemented by wa-sqlite adapter)
 */
export interface IStorageAdapter {
  /**
   * Initialize database and apply migrations
   */
  initialize(): Promise<void>;
  
  /**
   * Store node (INSERT OR REPLACE)
   */
  storeNode(node: JsonLdNode): Promise<string>;
  
  /**
   * Get node by ID
   */
  getNode(id: string): Promise<JsonLdNode | null>;
  
  /**
   * Query nodes with filters
   */
  queryNodes(filters: QueryFilters): Promise<JsonLdNode[]>;
  
  /**
   * Soft delete node
   */
  deleteNode(id: string): Promise<void>;
  
  /**
   * Permanently purge soft-deleted nodes
   */
  purgeDeleted(olderThan?: Date): Promise<number>;
  
  /**
   * Get storage statistics
   */
  getStats(vaultId: string): Promise<StorageStats>;
}

export interface QueryFilters {
  vaultId: string;             // Required
  type?: string;               // Optional: filter by @type
  limit?: number;              // Optional: max results
  offset?: number;             // Optional: pagination
  orderBy?: 'created' | 'updated';
  order?: 'asc' | 'desc';
}

export interface StorageStats {
  nodeCount: number;           // Total active nodes
  deletedCount: number;        // Soft-deleted nodes
  bytesUsed: number;           // Database file size
  oldestNode?: string;         // ISO timestamp
  newestNode?: string;         // ISO timestamp
}
```

---

## Test Coverage

### Integration Tests (BDD)

- [ ] Initialize empty database → schema created
- [ ] Store 1000 nodes → all persisted correctly
- [ ] Query by type with 100k nodes → <50ms
- [ ] Soft delete node → excluded from queries
- [ ] Purge deleted nodes → permanently removed
- [ ] Migrate v0.1.0 → v0.2.0 → data preserved

### Unit Tests (TDD)

- [ ] `storeNode()` validates JSON before insert
- [ ] `storeNode()` handles duplicate IDs (REPLACE)
- [ ] `queryNodes()` uses correct indexes
- [ ] `deleteNode()` sets deleted_at timestamp
- [ ] `purgeDeleted()` only removes old tombstones
- [ ] Migration runner applies pending migrations in order

---

## Implementation Tasks

### SDD (Current Phase)

- [x] Define core schema SQL
- [x] Define migration system design
- [x] Define IStorageAdapter interface
- [x] Document query optimization strategy
- [x] Link relevant ADRs

### BDD (Next Phase)

- [ ] Write integration test: schema initialization
- [ ] Write integration test: CRUD operations
- [ ] Write integration test: query performance
- [ ] Write integration test: migration flow

### TDD (Following Phase)

- [ ] Write unit tests for storeNode validation
- [ ] Write unit tests for query builders
- [ ] Write unit tests for MigrationRunner

### DDD (Implementation)

- [ ] Implement WaSqliteAdapter (IStorageAdapter)
- [ ] Implement MigrationRunner
- [ ] Implement initial migration (0001_initial_schema)
- [ ] Implement query optimizer
- [ ] Integrate with OPFS
- [ ] Add error handling + logging

---

## Performance Optimization

### Query Optimization Strategy

```sql
-- ✅ GOOD: Uses idx_nodes_vault index
SELECT * FROM nodes 
WHERE vault_id = 'uuid-123' AND deleted_at IS NULL 
ORDER BY updated_at DESC 
LIMIT 50;

-- ❌ BAD: Full table scan
SELECT * FROM nodes 
WHERE json_extract(data, '$.name') LIKE '%John%';

-- ✅ BETTER: Use FTS5 (Phase 2)
SELECT * FROM nodes_fts 
WHERE content MATCH 'John' 
LIMIT 50;
```

### Index Selection Rules

1. **Single vault queries**: Use `idx_nodes_vault` (most common)
2. **Type filtering**: Use `idx_nodes_type` (plugin-specific)
3. **Recent activity**: Use `idx_nodes_updated` (timeline views)
4. **Cleanup tasks**: Use `idx_nodes_deleted` (purge job)

### PRAGMA Settings

```sql
-- Enable Write-Ahead Log for better concurrency
PRAGMA journal_mode = WAL;

-- Optimize page size for OPFS
PRAGMA page_size = 4096;

-- Enable foreign keys (future use)
PRAGMA foreign_keys = ON;

-- Auto-vacuum for space reclamation
PRAGMA auto_vacuum = INCREMENTAL;
```

---

## Schema Evolution Examples

### Migration: Add Full-Text Search (v0.2.0)

```typescript
export const migration_002 = {
  version: '0.2.0',
  description: 'Add FTS5 virtual table for full-text search',
  
  async up(db: Database): Promise<void> {
    await db.exec(`
      CREATE VIRTUAL TABLE nodes_fts USING fts5(
        id UNINDEXED,
        type UNINDEXED,
        content,
        content=nodes,
        content_rowid=rowid
      );
      
      -- Populate FTS table
      INSERT INTO nodes_fts(rowid, id, type, content)
      SELECT rowid, id, type, json_extract(data, '$.name') FROM nodes;
    `);
  }
};
```

### Migration: Add Encryption (v0.3.0)

```typescript
export const migration_003 = {
  version: '0.3.0',
  description: 'Add encryption metadata column',
  
  async up(db: Database): Promise<void> {
    await db.exec(`
      ALTER TABLE nodes ADD COLUMN encrypted INTEGER DEFAULT 0;
      ALTER TABLE nodes ADD COLUMN encryption_key_id TEXT;
    `);
  }
};
```

---

## Data Integrity

### Validation Strategy

```typescript
// Before INSERT
function validateNode(node: JsonLdNode): void {
  if (!node['@id']) throw new Error('Missing @id');
  if (!node['@type']) throw new Error('Missing @type');
  if (node['@id'].length > 1000) throw new Error('@id too long');
  
  // Validate against JSON-LD schema (optional)
  const valid = jsonLdValidator.validate(node, sovereignGraphSchema);
  if (!valid) throw new Error('Schema validation failed');
}
```

### Backup Strategy

```sql
-- Export vault to JSON
SELECT json_group_array(
  json_object(
    'id', id,
    'type', type,
    'data', json(data),
    'created_at', created_at
  )
) FROM nodes WHERE vault_id = 'uuid-123' AND deleted_at IS NULL;
```

---

## References

- [ADR-009: OPFS Persistence Strategy](../ADRs/ADR-009-opfs-persistence-strategy.md)
- [ADR-010: Schema Evolution](../ADRs/ADR-010-schema-evolution.md)
- [ADR-015: SQLite Engine Decision](../ADRs/ADR-015-sqlite-engine-decision.md)
- [JSON-LD Schema](../../schemas/sovereign-graph.jsonld)
- [Feature: Storage Tiers](storage-tiers.md)
- [Storage Package Roadmap](../../packages/storage-sqlite/ROADMAP.md)
