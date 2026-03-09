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

export interface SyncAdapter {
  /** Initialize the sync engine and transports. */
  start(): Promise<void>;
  /** Gracefully shutdown. */
  stop(): Promise<void>;
  /** Apply a binary CRDT update (e.g. from a Nostr relay or WebRTC peer). */
  applyUpdate(update: Uint8Array): Promise<void>;
  /** Retrieve the current state as a binary update (delta or full state). */
  getUpdate(): Promise<Uint8Array>;
  /** Subscribe to local updates that need to be broadcast to the network. */
  onUpdate(callback: (update: Uint8Array) => void): () => void;
}

export interface SyncConformanceResult {
  pass: boolean;
  total: number;
  failed: number;
  failures: string[];
}
