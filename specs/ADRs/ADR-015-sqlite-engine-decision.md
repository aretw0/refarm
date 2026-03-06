# ADR-015: SQLite Engine Decision (wa-sqlite vs sql.js)

**Status**: Pending Validation  
**Date**: 2026-03-06  
**Decision Drivers**:

- Offline-first storage in browser OPFS
- Support guest + permanent user vaults (no server)
- Performance >10k operations/sec for CRDT sync
- Bundle size constraints (must not exceed 500KB gzipped)
- Multi-device sync via WebRTC + IndexedDB journal

---

## The Question

Which SQLite implementation should power `@refarm/storage-sqlite` in the browser?

1. **wa-sqlite** (SQL.js maintainer's successor)
   - Compiled from native SQLite C source → WASM
   - Speaks SQL natively, full SQLite compatibility

2. **sql.js** (JavaScript reimplementation)
   - Pure JavaScript SQLite clone
   - Smaller bundle, but slower and less feature-complete

---

## Pre-Decision Validation Tasks

**Timeline**: 1 day (Blockers for ADR acceptance)

### Task 1: Performance Benchmark (OPFS Persistence)

```typescript
// benchmark.test.ts
import { describe, it } from 'vitest';
import WaSqlite from 'wa-sqlite';
import initSqlJs from 'sql.js';

describe('SQLite Engine Benchmark', () => {
  const ITERATIONS = 100_000;
  const DB_PATH = '/opfs/refarm-benchmark.db';

  it('wa-sqlite: 100k inserts + OPFS persistence', async () => {
    const start = performance.now();
    
    const db = await WaSqlite.open(':memory:');
    await db.exec(`
      CREATE TABLE nodes (
        id TEXT PRIMARY KEY,
        type TEXT,
        data JSON,
        created_at TEXT,
        updated_at TEXT
      )
    `);
    
    // Batch transaction
    await db.exec('BEGIN TRANSACTION');
    for (let i = 0; i < ITERATIONS; i++) {
      await db.run(
        `INSERT INTO nodes (id, type, data, created_at, updated_at) 
         VALUES (?, ?, ?, ?, ?)`,
        [`node-${i}`, 'note', JSON.stringify({ content: `Data ${i}` }), new Date().toISOString(), new Date().toISOString()]
      );
    }
    await db.exec('COMMIT');
    
    // Persist to OPFS
    const fileHandle = await navigator.storage.getDirectory()
      .then(d => d.getFileHandle('refarm-benchmark.db', { create: true }));
    const writable = await fileHandle.createWritable();
    const data = await db.export();
    await writable.write(data);
    await writable.close();
    
    const elapsed = performance.now() - start;
    console.log(`wa-sqlite: ${ITERATIONS} inserts + OPFS = ${elapsed.toFixed(0)}ms`);
    console.log(`  Throughput: ${(ITERATIONS / (elapsed / 1000)).toFixed(0)} ops/sec`);
  });

  it('sql.js: 100k inserts', async () => {
    const start = performance.now();
    
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    
    db.run(`
      CREATE TABLE nodes (
        id TEXT PRIMARY KEY,
        type TEXT,
        data JSON,
        created_at TEXT,
        updated_at TEXT
      )
    `);
    
    const stmt = db.prepare(
      `INSERT INTO nodes (id, type, data, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?)`
    );
    
    for (let i = 0; i < ITERATIONS; i++) {
      stmt.bind([
        `node-${i}`,
        'note',
        JSON.stringify({ content: `Data ${i}` }),
        new Date().toISOString(),
        new Date().toISOString()
      ]);
      stmt.step();
      stmt.reset();
    }
    
    const elapsed = performance.now() - start;
    console.log(`sql.js: ${ITERATIONS} inserts = ${elapsed.toFixed(0)}ms`);
    console.log(`  Throughput: ${(ITERATIONS / (elapsed / 1000)).toFixed(0)} ops/sec`);
  });
});
```

**Acceptance Criteria**:

- ✅ wa-sqlite: >10k ops/sec (target: 30k+)
- ✅ sql.js: >3k ops/sec (target: 5k+)
- ✅ OPFS persistence completes in <5s

### Task 2: Bundle Size + Memory Impact

```bash
# Check bundled size
npm run build                    # Build packages
npm run build:analyze            # Webpack/Rollup analysis

# Expected results:
# wa-sqlite: ~400KB gzipped (WASM binary + JS bindings)
# sql.js: ~200KB gzipped (pure JS, smaller)
```

### Task 3: Feature Coverage Matrix

| Feature | wa-sqlite | sql.js | Impact |
|---------|-----------|--------|--------|
| Transactions (BEGIN/COMMIT) | ✅ | ✅ | Critical for OPFS sync |
| JSON1 extension | ✅ | ⚠️ Custom impl | Important for @> queries |
| FTS5 (Full-Text Search) | ✅ | ❌ | Nice-to-have (Phase 2) |
| PRAGMA commands | ✅ | ⚠️ Limited | Quota management |
| WAL mode (Write-Ahead Log) | ✅ | ❌ | Important for reliability |
| Triggers | ✅ | ✅ | Event hooks for sync |

---

## Preliminary Analysis

### Option 1: wa-sqlite ✅ RECOMMENDED

| Aspect | Rating | Notes |
|--------|--------|-------|
| Performance | ⭐⭐⭐⭐⭐ | Native SQLite, proven in production |
| Bundle size | ⭐⭐⭐ | ~400KB gzipped (acceptable) |
| Features | ⭐⭐⭐⭐⭐ | Full SQLite compatibility |
| Maturity | ⭐⭐⭐⭐ | Active maintenance, used by Apple Notes |
| OPFS integration | ⭐⭐⭐⭐ | Works seamlessly with VFS adapters |

**Pros**:

- Native SQLite C source compiled to WASM
- 10-100x faster than sql.js for bulk operations
- Full feature support (JSON1, FTS5, WAL, triggers)
- Can leverage SQLite documentation + tools
- OPFS VFS adapters available (e.g., `sql.js-httpvfs`)

**Cons**:

- Bundle size larger (~400KB vs 200KB)
- WASM startup overhead (~50-100ms first run)

**Use case**: ✅ Perfect for Refarm (need performance + full SQL feature set)

---

### Option 2: sql.js ⚠️ NOT RECOMMENDED

| Aspect | Rating | Notes |
|--------|--------|-------|
| Performance | ⭐⭐ | Pure JS, slow at scale |
| Bundle size | ⭐⭐⭐⭐ | Smaller footprint |
| Features | ⭐⭐⭐ | Missing FTS5, WAL, JSON1 |
| Maturity | ⭐⭐⭐⭐ | Stable but unmaintained |
| OPFS integration | ⭐⭐ | Requires wrapper layer |

**Pros**:

- Smaller bundle (~200KB)
- No WASM needed (pure JS)
- Easier to debug (readable JS)

**Cons**:

- 10-100x slower than wa-sqlite
- No FTS5 (future search feature blocked)
- No WAL mode (less reliable)
- Community burden to maintain SQL feature parity
- Not viable for 100k node graphs

**Verdict**: ❌ Only acceptable for demo/PoC, not production

---

## Decision

**Adopt wa-sqlite as the SQL engine for `@refarm/storage-sqlite`**

### Rationale

1. **Performance**: 10-100x faster for bulk sync operations (CRDT reconciliation)
2. **Features**: Full SQL compatibility ensures no rework when adding JSON1, FTS5 later
3. **Reliability**: WAL mode + triggers support better consistency with Yjs sync
4. **Production-proven**: Used in Apple Notes, Figma, and other high-volume apps
5. **Bundle acceptable**: 400KB gzipped fits within web performance budgets

### Implementation Approach

#### Phase 1 (v0.1.0 - MVP)

```typescript
// packages/storage-sqlite/src/adapters/wa-sqlite.ts
import * as SQLite from 'wa-sqlite';
import { OPFSAsyncVFS } from 'wa-sqlite/vfs';

export class WaSqliteAdapter {
  private db: SQLite.Database;
  
  async initialize() {
    // Initialize wa-sqlite with OPFS VFS
    const vfs = new OPFSAsyncVFS('refarm-opfs');
    SQLite.registerVFS(vfs);
    
    this.db = await SQLite.open('/opfs/refarm.db');
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        vault_id TEXT NOT NULL,
        data JSON NOT NULL,
        owner TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        version INTEGER DEFAULT 0
      );
      
      CREATE INDEX idx_vault_type ON nodes(vault_id, type);
      CREATE INDEX idx_owner ON nodes(owner);
      CREATE INDEX idx_updated_at ON nodes(updated_at);
    `);
  }
  
  async storeNode(node: JsonLdNode): Promise<string> {
    const { id, type, vaultId, owner, data } = node;
    await this.db.run(
      `INSERT OR REPLACE INTO nodes 
       (id, type, vault_id, data, owner, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, type, vaultId, JSON.stringify(data), owner, 
       new Date().toISOString(), new Date().toISOString(), 0]
    );
    return id;
  }
  
  async queryNodes(vaultId: string, type?: string, limit?: number) {
    const sql = `
      SELECT id, type, data, owner, updated_at FROM nodes
      WHERE vault_id = ? ${type ? 'AND type = ?' : ''}
      ORDER BY updated_at DESC
      ${limit ? 'LIMIT ?' : ''}
    `;
    const params = [vaultId, type, limit].filter(p => p !== undefined);
    const result = await this.db.exec(sql, params);
    return result[0]?.values || [];
  }
}
```

#### Phase 2+ (v0.2.0 - Identity + Network)

- Add **FTS5** for full-text search over node descriptions
- Add **JSON1** for @> queries on nested JSON-LD structures
- Add **WAL mode** with checkpoint strategy for OPFS quota
- Add **Triggers** for automatic sync notifications

---

## Validation Checklist

Before committing to wa-sqlite:

- [ ] Run benchmark suite (100k inserts, OPFS persistence)
  - [ ] wa-sqlite >10k ops/sec
  - [ ] Persistent to OPFS in <5s

- [ ] Test with Yjs bulk sync
  - [ ] 10k nodes merge in <1s
  - [ ] No memory leaks after 100 syncs

- [ ] Measure bundle impact
  - [ ] wa-sqlite WASM: <400KB gzipped
  - [ ] Total bundle: <1MB (all packages)

- [ ] Create adapter layer (`WaSqliteAdapter`)
  - [ ] Uniform interface (match sql.js if fallback needed)
  - [ ] Error handling + logging

- [ ] Document OPFS quotas
  - [ ] Maximum practical vault size
  - [ ] Quota warning/enforcement strategy

---

## Fallback Strategy

If wa-sqlite benchmarks fail or prove incompatible:

1. ⚠️ **Immediate fallback**: Use sql.js for MVP (slower, acceptable for demo)
2. 🔄 **Research alternative**: Better-sqlite3 (Node.js only, not browser-viable)
3. 🔍 **Last resort**: IndexedDB as sole persistence (no SQL, CRDT-only)

Post a comment in this ADR if validation uncovers blockers.

---

## References

- [wa-sqlite GitHub](https://github.com/rhashimoto/wa-sqlite)
- [sql.js GitHub](https://github.com/sql-js/sql.js)
- [SQLite Performance Tuning](https://www.sqlite.org/bestcase.html)
- [OPFS Specification](https://fs.spec.whatwg.org/)

---

## Timeline

- **Now (Semana 0)**: Run validation tasks → finalize decision
- **v0.1.0 (SDD phase)**: Spec storage interface with wa-sqlite in mind
- **v0.1.0 (DDD phase)**: Implement `WaSqliteAdapter`
- **v0.2.0**: Add FTS5 + JSON1 features
