export declare const STORAGE_CAPABILITY: "storage:v1";
export type StorageErrorCode = "NOT_FOUND" | "CONFLICT" | "INVALID_INPUT" | "UNAVAILABLE" | "INTERNAL";
export interface StorageRecord {
    id: string;
    type: string;
    payload: string;
    createdAt: string;
    updatedAt: string;
}
export interface StorageQuery {
    type?: string;
    limit?: number;
    offset?: number;
}
export interface StorageTelemetryEvent {
    traceId: string;
    pluginId: string;
    capability: typeof STORAGE_CAPABILITY;
    operation: "get" | "put" | "delete" | "query";
    durationMs: number;
    ok: boolean;
    errorCode?: StorageErrorCode;
}
export interface StorageProvider {
    readonly pluginId: string;
    readonly capability: typeof STORAGE_CAPABILITY;
    get(id: string): Promise<StorageRecord | null>;
    put(record: StorageRecord): Promise<void>;
    delete(id: string): Promise<void>;
    query(query: StorageQuery): Promise<StorageRecord[]>;
}
export interface StorageAdapter {
    ensureSchema(): Promise<void>;
    storeNode(id: string, type: string, context: string, payload: string, sourcePlugin: string | null): Promise<void>;
    queryNodes(type: string): Promise<any[]>;
    execute(sql: string, args?: any): Promise<any>;
    query<T = any>(sql: string, args?: any): Promise<T[]>;
    transaction<T>(fn: () => Promise<T>): Promise<T>;
    close(): Promise<void>;
}
export interface StorageConformanceResult {
    pass: boolean;
    total: number;
    failed: number;
    failures: string[];
}
//# sourceMappingURL=types.d.ts.map