/**
 * Mock Adapters for Tractor stress testing.
 *
 * These are in-memory implementations that simulate real adapter behavior
 * with configurable latency to surface bottlenecks.
 */

import type { IdentityAdapter } from "@refarm.dev/identity-contract-v1";
import type { StorageAdapter } from "@refarm.dev/storage-contract-v1";
import type { SyncAdapter } from "@refarm.dev/sync-contract-v1";

// ─── Configurable Delays ──────────────────────────────────────────────────────

export interface MockLatencyConfig {
  /** Delay in ms for ensureSchema(). Default: 0 */
  schemaMs?: number;
  /** Delay in ms for storeNode(). Default: 0 */
  storeMs?: number;
  /** Delay in ms for queryNodes(). Default: 0 */
  queryMs?: number;
  /** Delay in ms for execute(). Default: 0 */
  executeMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Mock Storage Adapter ─────────────────────────────────────────────────────

export class MockStorageAdapter implements StorageAdapter {
  private _store = new Map<string, any>();
  private _latency: Required<MockLatencyConfig>;

  /** Track call counts for assertions */
  readonly stats = {
    ensureSchema: 0,
    storeNode: 0,
    queryNodes: 0,
    execute: 0,
    query: 0,
    close: 0,
  };

  constructor(latency: MockLatencyConfig = {}) {
    this._latency = {
      schemaMs: latency.schemaMs ?? 0,
      storeMs: latency.storeMs ?? 0,
      queryMs: latency.queryMs ?? 0,
      executeMs: latency.executeMs ?? 0,
    };
  }

  async ensureSchema(): Promise<void> {
    this.stats.ensureSchema++;
    if (this._latency.schemaMs > 0) await sleep(this._latency.schemaMs);
  }

  async storeNode(
    id: string,
    type: string,
    context: string,
    payload: string,
    sourcePlugin: string | null
  ): Promise<void> {
    this.stats.storeNode++;
    if (this._latency.storeMs > 0) await sleep(this._latency.storeMs);
    this._store.set(id, { id, type, context, payload, sourcePlugin });
  }

  async queryNodes(type: string): Promise<any[]> {
    this.stats.queryNodes++;
    if (this._latency.queryMs > 0) await sleep(this._latency.queryMs);
    return [...this._store.values()]
      .filter((r) => r.type === type)
      .map((r) => ({ payload: r.payload }));
  }

  async execute(_sql: string, _args?: any): Promise<any> {
    this.stats.execute++;
    if (this._latency.executeMs > 0) await sleep(this._latency.executeMs);
    return 0;
  }

  async query<T = any>(_sql: string, _args?: any): Promise<T[]> {
    this.stats.query++;
    return [] as T[];
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  async close(): Promise<void> {
    this.stats.close++;
    this._store.clear();
  }

  get size(): number {
    return this._store.size;
  }
}

// ─── Mock Identity Adapter ────────────────────────────────────────────────────

export class MockIdentityAdapter implements IdentityAdapter {
  publicKey = "mock-pubkey-" + Math.random().toString(36).slice(2, 10);
}

// ─── Mock Sync Adapter ───────────────────────────────────────────────────────

export class MockSyncAdapter implements SyncAdapter {
  private _running = false;

  readonly stats = { start: 0, stop: 0 };

  async start(): Promise<void> {
    this.stats.start++;
    this._running = true;
  }

  async stop(): Promise<void> {
    this.stats.stop++;
    this._running = false;
  }

  get running(): boolean {
    return this._running;
  }
}

// ─── Factory Helpers ──────────────────────────────────────────────────────────

export function createMockConfig(latency?: MockLatencyConfig) {
  return {
    storage: new MockStorageAdapter(latency),
    identity: new MockIdentityAdapter(),
    sync: new MockSyncAdapter(),
  };
}
