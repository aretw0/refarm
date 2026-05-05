import {
  STORAGE_CAPABILITY,
  type StorageAdapter,
  type StorageProvider,
  type StorageQuery,
  type StorageRecord
} from "@refarm.dev/storage-contract-v1";

/**
 * @refarm.dev/storage-sqlite
 *
 * Sovereign SQLite/OPFS storage primitive.
 *
 * Designed to be used independently of the Refarm platform.
 * Implements the StorageAdapter interface so other engines can be swapped in.
 *
 * In the browser: uses the Origin Private File System (OPFS) via sqlite-wasm.
 * In Node.js:     uses the `better-sqlite3` binding.
 */

// ─── Physical Schema ────────────────────────────────────────────────────────

export const PHYSICAL_SCHEMA_V1 = [
  // Core nodes table (Materialized View)
  `CREATE TABLE IF NOT EXISTS nodes (
    id            TEXT PRIMARY KEY,
    type          TEXT NOT NULL,
    context       TEXT NOT NULL,
    payload       JSON NOT NULL,
    source_plugin TEXT,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  
  // CRDT Operation Log (The Truth)
  // Implements ADR-028: Triple-based Op-Log
  `CREATE TABLE IF NOT EXISTS crdt_log (
    id         TEXT PRIMARY KEY, -- Operation ID (peer/clock)
    node_id    TEXT NOT NULL,
    field      TEXT NOT NULL,
    value      JSON,
    peer_id    TEXT NOT NULL,
    hlc_time   TEXT NOT NULL,    -- Hybrid Logical Clock for convergence
    applied_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(node_id) REFERENCES nodes(id)
  )`,
  
  `CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type)`,
  `CREATE INDEX IF NOT EXISTS idx_crdt_node ON crdt_log(node_id)`,
];

/**
 * Browser-side SQLite adapter using the Origin Private File System or Memory.
 * Implements Multi-Vault (Namespace) isolation.
 */
export class OPFSSQLiteAdapter implements StorageAdapter {
  private _db: any = null;
  private _namespace: string = "default";
  private _sqlite: any = null;

  constructor(sqlite?: any) {
    // In a real browser environment, sqlite would be imported or injected
    this._sqlite = sqlite;
  }

  /**
   * Opens a namespaced vault. 
   * @param namespace The vault name (e.g. "prod", "dev", ":memory:").
   */
  async open(namespace: string): Promise<OPFSSQLiteAdapter> {
    const scoped = new OPFSSQLiteAdapter(this._sqlite);
    scoped._namespace = namespace;
    console.info(`[storage-sqlite] Opening namespaced vault: ${namespace}`);
    
    // 1. Identify Target Path
    const isMemory = namespace === ":memory:" || !namespace;
    const dbPath = isMemory ? ":memory:" : `/opfs/refarm-${namespace}.db`;

    // 2. Initialize Engine
    if (!scoped._sqlite) {
      console.warn("[storage-sqlite] No SQLite engine provided, falling back to memory stub");
      scoped._db = scoped._createMemoryStub();
    } else {
      scoped._db = await scoped._sqlite.open(dbPath);
    }

    return scoped;
  }

  async ensureSchema(): Promise<void> {
    await runMigrations(this, PHYSICAL_SCHEMA_V1);
  }

  async storeNode(
    id: string,
    type: string,
    context: string,
    payload: string,
    sourcePlugin: string | null,
  ): Promise<void> {
    const hlc = new Date().toISOString(); 
    const peerId = "local-host"; 

    await this.transaction(async () => {
      await this.execute(
        `INSERT OR REPLACE INTO crdt_log (id, node_id, field, value, peer_id, hlc_time)
         VALUES (?, ?, ?, ?, ?, ?)`,
        { params: [`${peerId}/${Date.now()}`, id, "@payload", payload, peerId, hlc] },
      );

      await this.execute(
        `INSERT OR REPLACE INTO nodes (id, type, context, payload, source_plugin, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
        { params: [id, type, context, payload, sourcePlugin] },
      );
    });
  }

  async getLogForNode(nodeId: string): Promise<any[]> {
    return this.query("SELECT * FROM crdt_log WHERE node_id = ? ORDER BY hlc_time ASC", { params: [nodeId] });
  }

  async queryNodes(type: string): Promise<any[]> {
    return this.query(
      "SELECT payload FROM nodes WHERE type = ? ORDER BY updated_at DESC",
      { params: [type] },
    );
  }

  async execute(sql: string, args: any = {}): Promise<any> {
    this._assertOpen();
    const params = args?.params || args;
    return await this._db.exec(sql, { bind: params });
  }

  async query<T = any>(sql: string, args: any = {}): Promise<T[]> {
    this._assertOpen();
    const params = args?.params || args;
    return await this._db.exec(sql, { 
      bind: params, 
      returnValue: 'resultRows', 
      rowMode: 'object' 
    });
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
    if (this._db) {
      await this._db.close();
    }
    this._db = null;
  }

  private _assertOpen(): void {
    if (!this._db) throw new Error(`[storage-sqlite] Vault "${this._namespace}" not open`);
  }

  private _createMemoryStub() {
    // Fallback for tests if real wa-sqlite is not injected
    return {
      exec: async (sql: string, options: any = {}) => {
        return [];
      },
      close: async () => {}
    };
  }
}

/**
 * storage:v1 provider facade.
 *
 * Until sqlite-wasm integration is wired end-to-end, this provider keeps data
 * in-memory while preserving the exact capability contract expected by kernel
 * conformance checks and third-party integrations.
 */
export class StorageSqliteV1Provider implements StorageProvider {
  readonly pluginId = "@refarm.dev/storage-sqlite";
  readonly capability = STORAGE_CAPABILITY;

  private readonly rows = new Map<string, StorageRecord>();

  async get(id: string): Promise<StorageRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async put(record: StorageRecord): Promise<void> {
    this.rows.set(record.id, record);
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }

  async query(query: StorageQuery): Promise<StorageRecord[]> {
    let values = [...this.rows.values()];

    if (query.type) {
      values = values.filter((row) => row.type === query.type);
    }

    const offset = query.offset ?? 0;
    const limit = query.limit ?? values.length;
    return values.slice(offset, offset + limit);
  }
}

export function createStorageV1Provider(): StorageProvider {
  return new StorageSqliteV1Provider();
}

export { createTaskV1StorageAdapter } from "./task-v1.adapter";
export { createSessionV1StorageAdapter } from "./session-v1.adapter";
// Node.js-specific exports live in @refarm.dev/storage-sqlite/node so browser
// bundles never pull node:sqlite into their dependency graph.

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
  const appliedIds = new Set(applied.map((r: { id: number }) => r.id));

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
