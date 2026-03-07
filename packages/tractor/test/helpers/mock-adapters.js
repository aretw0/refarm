/**
 * Mock Adapters for Tractor stress testing.
 *
 * These are in-memory implementations that simulate real adapter behavior
 * with configurable latency to surface bottlenecks.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ─── Mock Storage Adapter ─────────────────────────────────────────────────────
export class MockStorageAdapter {
    _store = new Map();
    _latency;
    /** Track call counts for assertions */
    stats = {
        ensureSchema: 0,
        storeNode: 0,
        queryNodes: 0,
        execute: 0,
        query: 0,
        close: 0,
    };
    constructor(latency = {}) {
        this._latency = {
            schemaMs: latency.schemaMs ?? 0,
            storeMs: latency.storeMs ?? 0,
            queryMs: latency.queryMs ?? 0,
            executeMs: latency.executeMs ?? 0,
        };
    }
    async ensureSchema() {
        this.stats.ensureSchema++;
        if (this._latency.schemaMs > 0)
            await sleep(this._latency.schemaMs);
    }
    async storeNode(id, type, context, payload, sourcePlugin) {
        this.stats.storeNode++;
        if (this._latency.storeMs > 0)
            await sleep(this._latency.storeMs);
        this._store.set(id, { id, type, context, payload, sourcePlugin });
    }
    async queryNodes(type) {
        this.stats.queryNodes++;
        if (this._latency.queryMs > 0)
            await sleep(this._latency.queryMs);
        return [...this._store.values()]
            .filter((r) => r.type === type)
            .map((r) => ({ payload: r.payload }));
    }
    async execute(_sql, _args) {
        this.stats.execute++;
        if (this._latency.executeMs > 0)
            await sleep(this._latency.executeMs);
        return 0;
    }
    async query(_sql, _args) {
        this.stats.query++;
        return [];
    }
    async transaction(fn) {
        return fn();
    }
    async close() {
        this.stats.close++;
        this._store.clear();
    }
    get size() {
        return this._store.size;
    }
}
// ─── Mock Identity Adapter ────────────────────────────────────────────────────
export class MockIdentityAdapter {
    publicKey = "mock-pubkey-" + Math.random().toString(36).slice(2, 10);
}
// ─── Mock Sync Adapter ───────────────────────────────────────────────────────
export class MockSyncAdapter {
    _running = false;
    stats = { start: 0, stop: 0 };
    async start() {
        this.stats.start++;
        this._running = true;
    }
    async stop() {
        this.stats.stop++;
        this._running = false;
    }
    get running() {
        return this._running;
    }
}
// ─── Factory Helpers ──────────────────────────────────────────────────────────
export function createMockConfig(latency) {
    return {
        storage: new MockStorageAdapter(latency),
        identity: new MockIdentityAdapter(),
        sync: new MockSyncAdapter(),
    };
}
//# sourceMappingURL=mock-adapters.js.map