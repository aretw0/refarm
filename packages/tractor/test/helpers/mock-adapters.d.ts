/**
 * Mock Adapters for Tractor stress testing.
 *
 * These are in-memory implementations that simulate real adapter behavior
 * with configurable latency to surface bottlenecks.
 */
import type { IdentityAdapter } from "@refarm.dev/identity-contract-v1";
import type { StorageAdapter } from "@refarm.dev/storage-contract-v1";
import type { SyncAdapter } from "@refarm.dev/sync-contract-v1";
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
export declare class MockStorageAdapter implements StorageAdapter {
    private _store;
    private _latency;
    /** Track call counts for assertions */
    readonly stats: {
        ensureSchema: number;
        storeNode: number;
        queryNodes: number;
        execute: number;
        query: number;
        close: number;
    };
    constructor(latency?: MockLatencyConfig);
    ensureSchema(): Promise<void>;
    storeNode(id: string, type: string, context: string, payload: string, sourcePlugin: string | null): Promise<void>;
    queryNodes(type: string): Promise<any[]>;
    execute(_sql: string, _args?: any): Promise<any>;
    query<T = any>(_sql: string, _args?: any): Promise<T[]>;
    transaction<T>(fn: () => Promise<T>): Promise<T>;
    close(): Promise<void>;
    get size(): number;
}
export declare class MockIdentityAdapter implements IdentityAdapter {
    publicKey: string;
}
export declare class MockSyncAdapter implements SyncAdapter {
    private _running;
    readonly stats: {
        start: number;
        stop: number;
    };
    start(): Promise<void>;
    stop(): Promise<void>;
    get running(): boolean;
}
export declare function createMockConfig(latency?: MockLatencyConfig): {
    storage: MockStorageAdapter;
    identity: MockIdentityAdapter;
    sync: MockSyncAdapter;
};
//# sourceMappingURL=mock-adapters.d.ts.map