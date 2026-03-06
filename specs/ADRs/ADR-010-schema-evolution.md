# ADR-010: JSON-LD Schema Evolution (Lenses & Upcasting)

**Status**: Proposed  
**Date**: 2026-03-06  
**Decision Drivers**:

- Beta testers will have stale data when schema evolves
- Refarm ships offline-first (no central server to migrate data)
- Data must remain queryable across schema versions
- JSON-LD normalization enables safe evolution

---

## The Problem

Imagine the situation in v0.2.0:

1. **v0.1.0** shipped with simple `Note` schema:

   ```jsonld
   {
     "@context": "http://refarm.local/context/v0",
     "@type": "Note",
     "title": "string",
     "content": "string"
   }
   ```

2. **v0.2.0** adds new fields (e.g., tags, time tracking):

   ```jsonld
   {
     "@context": "http://refarm.local/context/v1",
     "@type": "Note",
     "title": "string",
     "content": "string",
     "tags": ["string"],        // NEW
     "estimatedMinutes": number // NEW
   }
   ```

3. Beta tester A installed v0.1.0, created 1000 notes, then upgrades to v0.2.0.
   - Their notes are now in **v0 schema**
   - But the app code expects **v1 schema**
   - Query `note.tags` returns undefined (silent failure)
   - No automatic migration ran (offline = no server!)

---

## Solution: Upcasting via Lenses

We define **schema migration rules** as composable **Lenses** (functional optics) that:

1. Detect old schema version
2. Transform document structure
3. Populate sensible defaults for new fields
4. Return upgraded document

### Core Concept: Lens (Functional Optics)

```typescript
type Lens<S, A> = {
  get: (s: S) => A;        // Extract focus from source
  set: (a: A, s: S) => S;  // Update focus in source
};

// Example: Just a field
const titleLens: Lens<Note, string> = {
  get: (note) => note.title,
  set: (newTitle, note) => ({ ...note, title: newTitle })
};

// Example: Nested field with default
const tagsLens: Lens<Note, string[]> = {
  get: (note) => note.tags ?? [],
  set: (newTags, note) => ({ ...note, tags: newTags })
};
```

### Migration Rules (v0 → v1)

```typescript
// packages/storage-sqlite/src/migrations/note-v0-to-v1.ts
import { Lens } from '../lens';

export interface NoteV0 {
  '@type': 'Note';
  title: string;
  content: string;
  // No tags, no estimatedMinutes
}

export interface NoteV1 {
  '@type': 'Note';
  title: string;
  content: string;
  tags: string[];              // NEW (default: [])
  estimatedMinutes?: number;   // NEW (default: undefined)
}

// Define lenses
const tagsLens: Lens<NoteV0 | NoteV1, string[]> = {
  get: (note) => ('tags' in note) ? note.tags : [],
  set: (tags, note) => ({
    ...note,
    tags: tags.length > 0 ? tags : (delete note.tags, note)
  })
};

const estimatedMinutesLens: Lens<NoteV0 | NoteV1, number | undefined> = {
  get: (note) => ('estimatedMinutes' in note) ? note.estimatedMinutes : undefined,
  set: (minutes, note) => ({
    ...note,
    ...(minutes !== undefined ? { estimatedMinutes: minutes } : {})
  })
};

// Migration function
export function upgradeNoteV0toV1(noteV0: NoteV0): NoteV1 {
  // Infer tags from content (example: detect #hashtags)
  const inferred = inferTagsFromContent(noteV0.content);
  
  return {
    ...noteV0,
    tags: inferred,  // Populate with inferred defaults
    // estimatedMinutes stays undefined (user can set later)
  };
}

function inferTagsFromContent(content: string): string[] {
  const regex = /#(\w+)/g;
  const matches = content.match(regex) ?? [];
  return matches.map(m => m.slice(1)); // Remove # prefix
}
```

---

## Implementation: Migration Engine

### Architecture

```typescript
// packages/storage-sqlite/src/schema-manager.ts

interface SchemaMigration {
  fromVersion: string;
  toVersion: string;
  upgrade: (doc: any) => any;
  downgrade?: (doc: any) => any;  // For rollback
}

export class SchemaManager {
  private migrations: SchemaMigration[] = [];
  private currentVersion = 'v1';

  constructor() {
    // Register all migrations
    this.register({
      fromVersion: 'v0',
      toVersion: 'v1',
      upgrade: upgradeNoteV0toV1,
      downgrade: downgradeNoteV1toV0
    });
    
    // For future: v1 → v2, v2 → v3, etc.
  }

  /**
   * Detect document schema version from @context
   */
  private detectVersion(doc: any): string {
    const context = doc['@context'];
    if (context?.includes('/v1')) return 'v1';
    if (context?.includes('/v0')) return 'v0';
    return 'unknown';
  }

  /**
   * Upcast document to current schema
   * Handles multi-step migrations (v0 → v1 → v2)
   */
  public upcast(doc: any): any {
    const detectedVersion = this.detectVersion(doc);
    
    if (detectedVersion === this.currentVersion) {
      return doc; // Already up-to-date
    }

    // Find migration path
    let current = doc;
    let version = detectedVersion;

    while (version !== this.currentVersion) {
      const migration = this.migrations.find(
        m => m.fromVersion === version && m.toVersion === this.currentVersion
      );

      if (!migration) {
        throw new Error(
          `No migration path from ${version} to ${this.currentVersion}`
        );
      }

      current = migration.upgrade(current);
      version = migration.toVersion;
    }

    return current;
  }

  /**
   * Called before storing a document
   * Ensures all stored docs are v1
   */
  public async beforeStore(doc: any): Promise<any> {
    return this.upcast(doc);
  }

  /**
   * Called after retrieving a document
   * Ensures data consistency
   */
  public async afterFetch(doc: any): Promise<any> {
    return this.upcast(doc);
  }

  private register(migration: SchemaMigration) {
    this.migrations.push(migration);
  }
}
```

### Integration with Storage Layer

```typescript
// packages/storage-sqlite/src/adapter.ts

export class StorageAdapter {
  private schemaManager = new SchemaManager();

  async storeNode(node: any): Promise<string> {
    // Upcast before storing
    const upgraded = await this.schemaManager.beforeStore(node);

    const { id, type, data } = upgraded;
    await this.db.run(
      `INSERT OR REPLACE INTO nodes (id, type, data, ...)
       VALUES (?, ?, ?, ...)`,
      [id, type, JSON.stringify(data)]
    );
    return id;
  }

  async getNode(id: string): Promise<any> {
    const result = await this.db.exec(
      `SELECT data FROM nodes WHERE id = ?`,
      [id]
    );
    
    if (!result[0]) return null;

    const raw = JSON.parse(result[0].values[0]);
    // Upcast after fetching
    return await this.schemaManager.afterFetch(raw);
  }

  async queryNodes(query: any): Promise<any[]> {
    const results = await this.db.exec(`SELECT data FROM nodes ...`);
    // Upcast all results
    return Promise.all(
      results[0].values.map(row => 
        this.schemaManager.afterFetch(JSON.parse(row))
      )
    );
  }
}
```

---

## Recording Migrations in Vault Metadata

When a user upgrades, we record **which migrations were applied**:

```jsonld
{
  "@context": "http://refarm.local/context/vault",
  "@type": "Vault",
  "id": "vault-a7c3f2",
  "owner": "alice_pubkey",
  "created_at": "2026-03-06T...",
  "schema_version": "v1",
  "migrations": [
    {
      "migration": "note-v0-to-v1",
      "applied_at": "2026-03-10T14:23:45Z",
      "documents_affected": 1247,
      "schema_version_before": "v0",
      "schema_version_after": "v1"
    }
  ]
}
```

**Why?** Audit trail + debugging if migration fails mid-way.

---

## Downgrade Strategy (Rollback)

If user downgrades to v0.1.0, we need to **downgrade** documents:

```typescript
export function downgradeNoteV1toV0(noteV1: NoteV1): NoteV0 {
  // Strip new fields
  const { tags, estimatedMinutes, ...noteV0 } = noteV1;
  
  // Optionally: preserve tags as inline markdown
  if (tags && tags.length > 0) {
    noteV0.content = `${noteV0.content}\n\nTags: ${tags.join(', ')}`;
  }
  
  return noteV0;
}
```

**Caution**: Downgrade may lose data. Only recommend if there's a clear rollback path.

---

## Testing Schema Evolution

```typescript
// packages/storage-sqlite/src/migrations/note-v0-to-v1.test.ts

describe('Schema Migration: Note v0 → v1', () => {
  it('should preserve existing fields', () => {
    const v0: NoteV0 = {
      '@type': 'Note',
      title: 'My Note',
      content: 'Some content'
    };

    const v1 = upgradeNoteV0toV1(v0);
    expect(v1.title).toBe('My Note');
    expect(v1.content).toBe('Some content');
  });

  it('should infer tags from #hashtags in content', () => {
    const v0: NoteV0 = {
      '@type': 'Note',
      title: 'Meeting',
      content: 'Discussed #architecture and #performance'
    };

    const v1 = upgradeNoteV0toV1(v0);
    expect(v1.tags).toEqual(['architecture', 'performance']);
  });

  it('should set estimatedMinutes to undefined for old notes', () => {
    const v0: NoteV0 = { '@type': 'Note', title: '', content: '' };
    const v1 = upgradeNoteV0toV1(v0);
    expect(v1.estimatedMinutes).toBeUndefined();
  });

  it('should handle 1000 notes in <100ms', () => {
    const notes = Array(1000).fill({
      '@type': 'Note',
      title: 'Note',
      content: 'Content'
    });

    const start = performance.now();
    const upgraded = notes.map(upgradeNoteV0toV1);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100);
    expect(upgraded.length).toBe(1000);
  });
});
```

---

## Timeline

| Phase | What | When |
|-------|------|------|
| **v0.1.0** | Define base schema (v0) + initial Lens infrastructure | Sprint 1 |
| **v0.2.0** | Add schema fields + write v0→v1 migration + test | Sprint 3 |
| **v0.3.0+** | v1→v2, v2→v3, etc. (ongoing) | Future |

---

## Success Criteria

- ✅ Old documents auto-upgrade on first fetch (transparent to user)
- ✅ No data loss during migration
- ✅ Bulk migration (<1s for 10k documents)
- ✅ Migrations are reversible (downgrade path exists)
- ✅ Audit trail recorded (who migrated what when)

---

## References

- [Functional Optics (Lenses)](https://www.schoolofhaskell.com/school/to-infinity-and-beyond/pick-of-the-week/basic-lensing)
- [Event Sourcing Upcasting Pattern](https://www.eventstore.com/docs/dotnet-client/upcasting/latest.html)
- [JSON-LD Context Management](https://www.w3.org/TR/json-ld/#context)
