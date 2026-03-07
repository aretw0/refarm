export const SYNC_CAPABILITY = "sync:v1" as const;

export type SyncErrorCode =
  | "CONFLICT"
  | "NETWORK_ERROR"
  | "AUTH_FAILED"
  | "TIMEOUT"
  | "INTERNAL";

export interface SyncChange {
  id: string;
  timestamp: string;
  author: string;
  operation: "put" | "delete" | "update";
  resourceId: string;
  data?: unknown;
}

export interface SyncSession {
  sessionId: string;
  peerId: string;
  startedAt: string;
}

export interface SyncTelemetryEvent {
  traceId: string;
  pluginId: string;
  capability: typeof SYNC_CAPABILITY;
  operation: "connect" | "sync" | "disconnect" | "conflict";
  durationMs: number;
  ok: boolean;
  errorCode?: SyncErrorCode;
}

export interface SyncProvider {
  readonly pluginId: string;
  readonly capability: typeof SYNC_CAPABILITY;

  connect(endpoint: string): Promise<SyncSession>;
  push(changes: SyncChange[]): Promise<void>;
  pull(): Promise<SyncChange[]>;
  disconnect(sessionId: string): Promise<void>;
}

export interface SyncConformanceResult {
  pass: boolean;
  total: number;
  failed: number;
  failures: string[];
}
