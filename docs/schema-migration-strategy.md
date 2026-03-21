# Schema Migration Strategy

> **Context**: Before real users exist with `.db` files on disk, we need a documented
> upgrade path. Migrating silently or destructively would violate Sovereign principles.

**Status**: Groundwork documented — `refarm migrate` command exists, contract below.
**Related**: [Gate 2](v0.1.0-release-gate.md#gate-2-farmhand--tractor-daemon-transition),
[ADR-048](../specs/ADRs/ADR-048-tractor-graduation.md),
[`packages/tractor/docs/ARCHITECTURE.md`](../packages/tractor/docs/ARCHITECTURE.md)

---

## Current State: SCHEMA_V1

`PHYSICAL_SCHEMA_V1` is defined in `packages/storage-sqlite` and shared between:
- TypeScript Tractor (`tractor-ts`)
- Rust Tractor (`tractor` binary)

Compatibility is verified by the `schema_compat_ts_db_readable` conformance test, which
opens a DB written by the Rust binary with the TS reader (and vice versa). **This test
must remain green across all schema bumps.**

### V1 Tables

| Table | Purpose |
|-------|---------|
| `nodes` | CRDT node store (id, type, context, payload, sourcePlugin, updatedAt) |
| `loro_updates` | Raw Loro binary deltas for sync replay |
| `plugin_manifests` | Installed plugin metadata + integrity hashes |
| `trust_grants` | Plugin trust levels (ExecutionProfile, SecurityMode) |

---

## Upgrade Path: V1 → V2 (when needed)

SQLite supports `ALTER TABLE ... ADD COLUMN` without data loss or table recreation.
This is the only migration primitive we should use for additive changes.

### What is safe

```sql
-- Adding a column (additive, safe):
ALTER TABLE nodes ADD COLUMN tags TEXT DEFAULT NULL;

-- Adding an index (safe, no data loss):
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
```

### What is NEVER allowed

```sql
-- NEVER do this in a user migration:
DROP TABLE nodes;       -- destroys user data
DROP TABLE loro_updates; -- loses sync history

-- NEVER rename columns without a two-phase migration:
ALTER TABLE nodes RENAME COLUMN payload TO content; -- OK in SQLite 3.25+, but
                                                     -- breaks TS/Rust readers until
                                                     -- both sides are updated
```

### Non-additive changes (column rename / type change)

1. **Phase 1**: Add the new column alongside the old one (both sides write both).
2. **Phase 2**: Migrate data: `UPDATE nodes SET content = payload WHERE content IS NULL`.
3. **Phase 3**: Drop old column only after all readers are updated and deployed.
4. **Never skip phases** even if you control both reader and writer.

---

## `refarm migrate` Contract

The `refarm migrate` command (in `@refarm.dev/cli`) is the user-facing entry point.

```bash
refarm migrate --db ~/.local/share/refarm/refarm.db
```

### Expected behavior

1. **Detect schema version**: Read `PRAGMA user_version` from the DB.
2. **Diff against target**: Compare to the version compiled into the current binary.
3. **Dry-run by default**: Print the SQL that would be applied, do not execute.
4. **Apply with `--apply`**: Execute migrations inside a single transaction.
5. **Backup first**: Before `--apply`, copy the `.db` file to `<name>.bak.<timestamp>.db`.
6. **Rollback on error**: If any statement fails, `ROLLBACK` — never leave a half-migrated DB.

### Version tracking

```sql
PRAGMA user_version = 1; -- set after V1 migration
PRAGMA user_version = 2; -- set after V2 migration
```

Both the Rust binary and the TS reader check `PRAGMA user_version` on open and refuse
to operate on a DB version higher than they understand (forward-compatibility guard).

---

## Testing Requirements

Every schema migration must have:

1. **Conformance test** in `packages/storage-sqlite/tests/` that:
   - Creates a V(n-1) DB.
   - Runs the migration.
   - Verifies the V(n) schema with `schema_compat_ts_db_readable`.

2. **Roundtrip test**: Write data in V(n-1), migrate, read in V(n) — assert no data loss.

3. **Guard test**: Open a V(n) DB with a V(n-1) binary — assert a clean error, not a crash.

---

## Decision Log

| Date | Decision | Reason |
|------|----------|--------|
| 2026-03-19 | SCHEMA_V1 frozen at graduation | ADR-048: no breaking changes until v0.1.0 |
| 2026-03-20 | `ALTER TABLE` as sole migration primitive | Prevents accidental data loss; SQLite supports it natively |
| 2026-03-20 | Backup-before-apply enforced in CLI | User sovereignty: their data, their backup |
