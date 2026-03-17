import type { StorageAdapter } from "@refarm.dev/storage-contract-v1";

/**
 * Configuration for RestStorageAdapter.
 *
 * The adapter expects the backend to expose two endpoints by default:
 *   POST {baseUrl}/nodes           — storeNode
 *   GET  {baseUrl}/nodes?type=...  — queryNodes
 *
 * Optionally, if `enableSql` is true:
 *   POST {baseUrl}/sql             — execute / query (raw SQL passthrough)
 *
 * All paths are configurable via `endpoints`.
 */
export interface RestStorageOptions {
  /** Base URL of the backend API (no trailing slash). */
  baseUrl: string;
  /** HTTP headers sent with every request (e.g. Authorization). */
  headers?: Record<string, string>;
  /**
   * Enable the SQL passthrough endpoints (`execute` / `query`).
   * Defaults to false. Most REST backends will not expose raw SQL.
   */
  enableSql?: boolean;
  /**
   * Override individual endpoint paths (relative to baseUrl).
   * Defaults: storeNode → "/nodes", queryNodes → "/nodes", sql → "/sql"
   */
  endpoints?: {
    storeNode?: string;
    queryNodes?: string;
    sql?: string;
  };
}

/**
 * RestStorageAdapter — implements StorageAdapter over any HTTP/REST backend.
 *
 * This is the proof that Refarm blocks are philosophy-neutral: you can run
 * @refarm.dev/tractor with a traditional centralized API without any CRDT,
 * OPFS, or offline-first machinery.
 *
 * Usage:
 *   const storage = new RestStorageAdapter({
 *     baseUrl: "https://api.example.com",
 *     headers: { Authorization: "Bearer token" },
 *   });
 *   const tractor = await Tractor.boot({ storage, identity, namespace: "myapp" });
 *
 * See: ADR-046 — Refarm Composition Model
 */
export class RestStorageAdapter implements StorageAdapter {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly enableSql: boolean;
  private readonly nodesPath: string;
  private readonly sqlPath: string;

  constructor(options: RestStorageOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, ""); // strip trailing slash
    this.headers = options.headers ?? {};
    this.enableSql = options.enableSql ?? false;
    this.nodesPath = options.endpoints?.storeNode ?? "/nodes";
    this.sqlPath = options.endpoints?.sql ?? "/sql";
  }

  // ── StorageAdapter ──────────────────────────────────────────────────────

  async ensureSchema(): Promise<void> {
    // no-op: schema is the backend's responsibility
  }

  async storeNode(
    id: string,
    type: string,
    context: string,
    payload: string,
    sourcePlugin: string | null,
  ): Promise<void> {
    await this._post(this.nodesPath, { id, type, context, payload, sourcePlugin });
  }

  async queryNodes(type: string): Promise<any[]> {
    const queryPath =
      (this.nodesPath) +
      "?type=" + encodeURIComponent(type);
    return this._get(queryPath);
  }

  async execute(sql: string, args?: any): Promise<any> {
    if (!this.enableSql) return [];
    return this._post(this.sqlPath, { sql, args });
  }

  async query<T = any>(sql: string, args?: any): Promise<T[]> {
    return this.execute(sql, args) as Promise<T[]>;
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // REST has no native transaction semantics — best-effort sequential execution.
    // For transactional guarantees, use a backend that exposes a transaction endpoint
    // and override this method in a subclass.
    return fn();
  }

  async close(): Promise<void> {
    // no-op: no persistent connection to tear down
  }

  // ── HTTP helpers ────────────────────────────────────────────────────────

  private async _get(path: string): Promise<any> {
    const res = await fetch(this.baseUrl + path, {
      headers: this.headers,
    });
    if (!res.ok) {
      throw new Error(`[storage-rest] GET ${path} → HTTP ${res.status}`);
    }
    return res.json();
  }

  private async _post(path: string, body: unknown): Promise<any> {
    const res = await fetch(this.baseUrl + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.headers },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`[storage-rest] POST ${path} → HTTP ${res.status}`);
    }
    // Some endpoints return 204 No Content — gracefully handle empty body
    return res.json().catch(() => undefined);
  }
}
