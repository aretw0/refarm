/**
 * @refarm/storage-sqlite
 *
 * Sovereign SQLite/OPFS storage primitive.
 *
 * Designed to be used independently of the Refarm platform.
 * Implements the StorageAdapter interface so other engines can be swapped in.
 *
 * In the browser: uses the Origin Private File System (OPFS) via sqlite-wasm.
 * In Node.js:     uses the `better-sqlite3` binding.
 */

// ─── Public Types ────────────────────────────────────────────────────────────

/** A single row returned from a query, typed as a plain object. */
export type Row = Record<string, unknown>;

/** Options accepted by StorageAdapter.query() */
export interface QueryOptions {
  /** Bound parameters (positional or named). */
  params?: unknown[];
}

/** The minimal contract every storage back-end must satisfy. */
export interface StorageAdapter {
  /**
   * Open (or create) the database at the given logical name.
   * Returns the same adapter instance for chaining.
   */
  open(name: string): Promise<StorageAdapter>;

  /** Execute a write statement; returns the number of affected rows. */
  execute(sql: string, options?: QueryOptions): Promise<number>;

  /** Execute a read statement; returns all matching rows. */
  query<T extends Row = Row>(sql: string, options?: QueryOptions): Promise<T[]>;

  /** Wrap multiple operations in a single ACID transaction. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;

  /** Gracefully close the database connection. */
  close(): Promise<void>;
}

// ─── SQLite / OPFS Adapter ───────────────────────────────────────────────────

/**
 * Browser-side SQLite adapter using the Origin Private File System.
 *
 * NOTE: Actual sqlite-wasm bootstrapping is deferred to runtime so that this
 * module can be imported in environments that lack OPFS (e.g. test runners)
 * without throwing at import time.  Replace the `_db` stubs below with a real
 * sqlite-wasm instance once you wire up the WASM binary.
 */
export class OPFSSQLiteAdapter implements StorageAdapter {
  /** @internal */
  private _db: unknown = null;

  async open(name: string): Promise<StorageAdapter> {
    // TODO: initialise sqlite-wasm with OPFS VFS:
    //
    //   const { default: sqlite3InitModule } = await import('@sqlite.org/sqlite-wasm');
    //   const sqlite3 = await sqlite3InitModule({ print: console.log });
    //   this._db = new sqlite3.oo1.OpfsDb(`/${name}.sqlite3`);
    //
    console.info(`[storage-sqlite] Opening database: ${name}`);
    return this;
  }

  async execute(sql: string, options: QueryOptions = {}): Promise<number> {
    this._assertOpen();
    // TODO: delegate to this._db.exec(sql, { bind: options.params })
    void sql;
    void options;
    return 0;
  }

  async query<T extends Row = Row>(sql: string, options: QueryOptions = {}): Promise<T[]> {
    this._assertOpen();
    // TODO: delegate to this._db.exec(sql, { bind: options.params, returnValue: 'resultRows', rowMode: 'object' })
    void sql;
    void options;
    return [] as T[];
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    this._assertOpen();
    await this.execute("BEGIN");
    try {
      const result = await fn();
      await this.execute("COMMIT");
      return result;
    } catch (err) {
      await this.execute("ROLLBACK");
      throw err;
    }
  }

  async close(): Promise<void> {
    // TODO: (this._db as any)?.close();
    this._db = null;
  }

  private _assertOpen(): void {
    // In production, check this._db !== null and throw if not open.
  }
}

// ─── Schema Migrations ───────────────────────────────────────────────────────

/**
 * A lightweight migration runner.
 * Pass an ordered array of SQL strings; each will be applied once and tracked
 * in a `_migrations` meta-table.
 */
export async function runMigrations(
  adapter: StorageAdapter,
  migrations: string[]
): Promise<void> {
  await adapter.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id        INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = await adapter.query<{ id: number }>(
    "SELECT id FROM _migrations ORDER BY id"
  );
  const appliedIds = new Set(applied.map((r) => r.id));

  for (let i = 0; i < migrations.length; i++) {
    if (!appliedIds.has(i)) {
      await adapter.transaction(async () => {
        await adapter.execute(migrations[i]);
        await adapter.execute("INSERT INTO _migrations (id) VALUES (?)", {
          params: [i],
        });
      });
    }
  }
}

// ─── Default Export ───────────────────────────────────────────────────────────
export default OPFSSQLiteAdapter;
