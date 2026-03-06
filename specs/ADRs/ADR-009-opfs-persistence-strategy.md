# ADR-009: OPFS Persistence Strategy

**Status**: Accepted  
**Date**: 2026-03-06  
**Deciders**: Core Team  
**Related**: [ADR-002 (Offline-First)](ADR-002-offline-first-architecture.md), [ADR-003 (CRDT)](ADR-003-crdt-synchronization.md)

---

## Context

Refarm stores all user data locally in the browser. We need a persistence strategy that:

1. **Survives browser restarts** (not sessionStorage)
2. **Handles large datasets** (~100GB+, not limited to 5-10MB)
3. **Works with SQLite WASM** (requires synchronous file I/O)
4. **Isolated per origin** (secure, no cross-site access)
5. **Performant** (fast reads/writes for CRDT + SQL)

**Available browser storage APIs**:

| API | Max Size | Sync I/O | Persistence | Use Case |
|-----|----------|----------|-------------|----------|
| localStorage | ~5-10MB | ✅ | ✅ | Key-value (small) |
| sessionStorage | ~5-10MB | ✅ | ❌ (tab close) | Temporary |
| IndexedDB | ~100GB | ❌ (async) | ✅ | Structured data |
| Cache API | ~100GB | ❌ (async) | ✅ | HTTP responses |
| **OPFS** | **~100GB** | **✅** | **✅** | **File system** |

**The question**: How do we structure OPFS storage for SQLite database + CRDT state + plugin files?

---

## Decision

**We use OPFS (Origin Private File System) as primary storage with this structure:**

```
/opfs/ (origin private)
├── vaults/
│   ├── guest-{uuid}/          # Guest vault
│   │   ├── refarm.db          # SQLite database (JSON-LD nodes)
│   │   ├── refarm.db-wal      # Write-Ahead Log (SQLite)
│   │   └── refarm.db-shm      # Shared memory (SQLite)
│   │
│   └── {nostr-pubkey}/        # Permanent user vault
│       ├── refarm.db
│       ├── refarm.db-wal
│       └── refarm.db-shm
│
├── plugins/
│   ├── {plugin-hash}.wasm     # Cached plugin binaries
│   └── {plugin-hash}.wit      # WIT interface definitions
│
└── backups/
    └── {vault-id}-{timestamp}.db  # User-initiated backups
```

### Storage Layers

#### Layer 1: SQLite Database (OPFS)

**Purpose**: Store JSON-LD semantic graph

**Implementation**:

- **Library**: [wa-sqlite](https://github.com/rhashimoto/wa-sqlite) or [sql.js](https://github.com/sql-js/sql.js)
- **File**: `/opfs/vaults/{vaultId}/refarm.db`
- **Access**: `FileSystemSyncAccessHandle` (sync I/O in Web Worker)
- **WAL mode**: Enabled for concurrency + crash recovery

**Schema**:

```sql
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,           -- @id (IRI)
  type TEXT NOT NULL,            -- @type
  data TEXT NOT NULL,            -- Full JSON-LD (CHECK json_valid(data))
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX idx_nodes_type ON nodes(type);
CREATE INDEX idx_nodes_updated ON nodes(updated_at);

-- Full-text search
CREATE VIRTUAL TABLE nodes_fts USING fts5(
  id UNINDEXED,
  content,
  content=nodes,
  content_rowid=rowid
);
```

#### Layer 2: CRDT State (IndexedDB)

**Purpose**: Persist Yjs CRDT updates

**Implementation**:

- **Library**: `y-indexeddb` (official Yjs provider)
- **Database**: `y-indexeddb:refarm-crdt-{vaultId}`
- **Why not OPFS?**: IndexedDB better for append-only logs (CRDT updates)

**Structure**:

```typescript
// IndexedDB stores
{
  "updates": [
    { clock: 1, update: Uint8Array(...) },
    { clock: 2, update: Uint8Array(...) },
    // ...
  ],
  "state": Uint8Array(...) // Compacted state
}
```

#### Layer 3: Metadata (localStorage)

**Purpose**: Bootstrap data (fast sync access)

**Implementation**:

- **Key**: `refarm:vault`
- **Value**: `{ vaultId, type: 'guest' | 'permanent', pubkey? }`

**Why localStorage?**:

- Available synchronously on main thread (before Worker loads)
- Small data (< 1KB)
- Bootstraps OPFS path resolution

```typescript
// On first boot
const vaultMeta = {
  vaultId: crypto.randomUUID(),
  type: 'guest',
  storageTier: 'persistent',
  created: Date.now()
};
localStorage.setItem('refarm:vault', JSON.stringify(vaultMeta));
```

### File Access Pattern

**Main Thread**:

```typescript
// Get OPFS root (async)
const opfsRoot = await navigator.storage.getDirectory();

// Navigate to vault
const vaultsDir = await opfsRoot.getDirectoryHandle('vaults', { create: true });
const vaultDir = await vaultsDir.getDirectoryHandle(vaultId, { create: true });

// Get database file handle
const dbFileHandle = await vaultDir.getFileHandle('refarm.db', { create: true });

// Transfer handle to Worker (no data copy)
worker.postMessage({ type: 'init', dbFileHandle }, [dbFileHandle]);
```

**Web Worker** (SQLite runs here):

```typescript
// Receive file handle
const dbFileHandle = event.data.dbFileHandle;

// Create sync access handle (ONLY works in Worker)
const syncHandle = await dbFileHandle.createSyncAccessHandle();

// SQLite can now use sync I/O
syncHandle.write(buffer); // Synchronous write
const bytesRead = syncHandle.read(buffer); // Synchronous read
syncHandle.flush(); // Persist to disk
```

### Quota Management

**Query quota**:

```typescript
const estimate = await navigator.storage.estimate();
console.log(`Used: ${estimate.usage} / ${estimate.quota}`);
// Example: Used: 52428800 / 107374182400 (50MB / 100GB)
```

**Request persistent storage** (prevent eviction):

```typescript
const isPersistent = await navigator.storage.persist();
if (isPersistent) {
  console.log('Storage will not be cleared automatically');
}
```

**Quota exceeded handling**:

```typescript
try {
  await syncHandle.write(buffer);
} catch (err) {
  if (err.name === 'QuotaExceededError') {
    // Alert user, offer to export data or clear old backups
    showQuotaExceededDialog();
  }
}
```

### Backup Strategy

**Export database**:

```typescript
async function exportDatabase(vaultId: string): Promise<Blob> {
  const opfsRoot = await navigator.storage.getDirectory();
  const dbFile = await opfsRoot
    .getDirectoryHandle(`vaults/${vaultId}`)
    .getFileHandle('refarm.db');
  
  const file = await dbFile.getFile();
  return new Blob([file], { type: 'application/x-sqlite3' });
}

// User downloads as file
const blob = await exportDatabase(vaultId);
const url = URL.createObjectURL(blob);
downloadLink.href = url;
downloadLink.download = `refarm-backup-${Date.now()}.db`;
```

**Import database**:

```typescript
async function importDatabase(vaultId: string, file: File): Promise<void> {
  const opfsRoot = await navigator.storage.getDirectory();
  const dbFile = await opfsRoot
    .getDirectoryHandle(`vaults/${vaultId}`)
    .getFileHandle('refarm.db', { create: true });
  
  const writable = await dbFile.createWritable();
  await writable.write(file);
  await writable.close();
  
  // Restart kernel to load new database
  await kernel.restart();
}
```

---

## Alternatives Considered

### Alternative 1: IndexedDB Only

**Approach**: Store SQLite database as Blob in IndexedDB

**Pros**:

- Single storage API
- Wider browser support (older browsers)

**Cons**:

- **No sync I/O**: Must load entire DB into memory first
- **Poor performance**: Every query requires memory copy (GB-scale data)
- **Memory limits**: Browser may OOM on large databases

**Rejected**: Performance unacceptable for large datasets

### Alternative 2: In-Memory SQLite (sql.js)

**Approach**: Load database into WASM heap, serialize to IndexedDB on changes

**Pros**:

- Fast queries (in-memory)
- Mature library (sql.js well-tested)

**Cons**:

- **Memory limit**: ~500MB-1GB max (browser heap limit)
- **Slow persistence**: Must serialize entire DB on every write
- **Data loss risk**: Crashes before flush = lost data

**Rejected**: Doesn't scale to 100GB target

### Alternative 3: Remote Storage (WebDAV, S3)

**Approach**: Store database on remote server, cache locally

**Pros**:

- Unlimited storage
- Automatic backup

**Cons**:

- **Violates offline-first**: Requires network
- **Privacy concern**: Data leaves device
- **Complexity**: Sync conflicts with remote server

**Rejected**: Conflicts with core architecture

### Alternative 4: File System Access API

**Approach**: Access user's local file system (e.g., `~/Documents/refarm/`)

**Pros**:

- True native file access
- User controls location

**Cons**:

- **Requires permission**: User must grant folder access (friction)
- **Security risk**: Malicious site could read files
- **Limited support**: Not available in Firefox, Safari

**Rejected**: UX friction + browser support issues

---

## Consequences

### Positive

1. **Large capacity**: ~100GB storage (browser-dependent)
2. **Fast I/O**: Synchronous access via `FileSystemSyncAccessHandle`
3. **SQLite native**: No serialization overhead
4. **Secure**: Origin-isolated, no cross-site access
5. **Persistent**: Survives browser restart
6. **Standard**: W3C spec, shipping in major browsers

### Negative

1. **Browser support**: Chrome 102+, Firefox 111+, Safari 15.2+ (no IE11)
2. **Worker-only**: Sync access requires Web Worker (adds complexity)
3. **Quota limits**: User may hit 100GB cap (must handle gracefully)
4. **No native backup**: User must manually export (UX concern)

### Neutral

1. **IndexedDB for CRDT**: Separate from SQLite (2 storage layers)
2. **localStorage for bootstrap**: Third layer (small, fast)
3. **No encryption at rest**: OPFS is plaintext (future: add encryption layer)

---

## Implementation Checklist

- [ ] OPFS directory structure creation (vaults/, plugins/, backups/)
- [ ] SQLite WASM + OPFS adapter (wa-sqlite or sql.js)
- [ ] Web Worker for database access
- [ ] Quota monitoring (estimate.usage alerts)
- [ ] Export/import database functions
- [ ] Persistent storage request (navigator.storage.persist)
- [ ] Error handling (QuotaExceededError)
- [ ] Migration from old storage (if exists)

---

## Browser Support

| Browser | OPFS | Sync Handle | Notes |
|---------|------|-------------|-------|
| Chrome | 86+ | 102+ | Full support |
| Edge | 86+ | 102+ | Full support |
| Firefox | 111+ | 111+ | Requires Web Worker |
| Safari | 15.2+ | 15.2+ | Experimental flag in 15.2-16.3 |
| Mobile Safari | 15.2+ | 15.2+ | Same as desktop |

**Polyfill strategy**: Fall back to IndexedDB on older browsers (degraded performance)

---

## References

- [OPFS Spec (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API)
- [FileSystemSyncAccessHandle](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemSyncAccessHandle)
- [wa-sqlite](https://github.com/rhashimoto/wa-sqlite)
- [sql.js](https://github.com/sql-js/sql.js)
- [Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API)
