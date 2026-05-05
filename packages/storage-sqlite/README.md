# @refarm.dev/storage-sqlite

Sovereign SQLite/OPFS storage primitive — implements `storage:v1`, `task:v1`, and `session:v1` contracts backed by a CRDT op-log (ADR-028). Usable independently of the full Refarm stack.

## When to use

- You need a local-first, offline-capable storage layer in the browser (OPFS) or Node.js.
- You are implementing a `task:v1` or `session:v1` adapter and want the reference SQLite implementation.
- You are composing with `@refarm.dev/sync-loro`: this package serves as the **read model** (SQL-queryable materialized view); Loro is the write model.

## Installation

```bash
npm install @refarm.dev/storage-sqlite
```

## Architecture

```
Write path:  LoroDoc (CRDT) → op-log table (triples) → Projector → nodes table
Read path:   nodes table → StorageAdapter queries
```

The schema has two tables:
- `nodes` — materialized view of current state (fast reads)
- `crdt_ops` — append-only op-log using Hybrid Logical Clock timestamps (convergence guarantee)

See ADR-028 for the triple-based op-log design.

## Usage

### Browser (OPFS)

```typescript
import { OPFSSQLiteAdapter } from "@refarm.dev/storage-sqlite";

const adapter = new OPFSSQLiteAdapter("my-app");
await adapter.open(); // opens /opfs/refarm-my-app.db

await adapter.put({ id: "note-1", type: "note", payload: "{}", createdAt: "...", updatedAt: "..." });
const note = await adapter.get("note-1");
```

### In-memory (tests / Node.js)

```typescript
import { StorageSqliteV1Provider } from "@refarm.dev/storage-sqlite";

const provider = new StorageSqliteV1Provider(); // falls back to :memory:
await provider.open();
```

### Task contract adapter

```typescript
import { createTaskV1StorageAdapter } from "@refarm.dev/storage-sqlite";

const adapter = createTaskV1StorageAdapter(sqliteDb);
const task = await adapter.create({ "@type": "Task", title: "...", status: "pending", ... });
```

### Session contract adapter

```typescript
import { createSessionV1StorageAdapter } from "@refarm.dev/storage-sqlite";

const adapter = createSessionV1StorageAdapter(sqliteDb);
```

### Schema migrations

```typescript
import { runMigrations, PHYSICAL_SCHEMA_V1 } from "@refarm.dev/storage-sqlite";

await runMigrations(db); // idempotent — safe to call on every startup
```

## Conformance

```typescript
import { runStorageV1Conformance } from "@refarm.dev/storage-contract-v1";
import { runTaskV1Conformance } from "@refarm.dev/task-contract-v1";
import { runSessionV1Conformance } from "@refarm.dev/session-contract-v1";
import { StorageSqliteV1Provider, createTaskV1StorageAdapter, createSessionV1StorageAdapter } from "@refarm.dev/storage-sqlite";

const result = await runStorageV1Conformance(new StorageSqliteV1Provider());
expect(result.pass).toBe(true);
```

## Related ADRs

- [ADR-009](../../specs/ADRs/ADR-009-opfs-persistence.md) — OPFS persistence strategy
- [ADR-015](../../specs/ADRs/ADR-015-sqlite-engine.md) — SQLite engine choice
- [ADR-028](../../specs/ADRs/ADR-028-crdt-sqlite-convergence.md) — CRDT-SQLite CQRS convergence

## License

MIT
