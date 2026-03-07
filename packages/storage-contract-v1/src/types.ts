export const STORAGE_CAPABILITY = "storage:v1" as const;

export type StorageErrorCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_INPUT"
  | "UNAVAILABLE"
  | "INTERNAL";

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

export interface StorageConformanceResult {
  pass: boolean;
  total: number;
  failed: number;
  failures: string[];
}
