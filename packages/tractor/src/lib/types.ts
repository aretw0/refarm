import { StorageAdapter } from "@refarm.dev/storage-contract-v1";
import { IdentityAdapter } from "@refarm.dev/identity-contract-v1";
import { SyncAdapter } from "@refarm.dev/sync-contract-v1";

export interface TractorConfig {
  /** The abstract storage mechanism (e.g., OPFS SQLite adapter). */
  storage: StorageAdapter;
  /** The vault namespace for this tractor instance (e.g. 'prod', 'dev', ':memory:'). */
  namespace: string;
  /** The user identity mechanism (e.g., Nostr Keypair adapter). */
  identity: IdentityAdapter;
  /** (Optional) Multi-device CRDT synchronization adapter. */
  sync?: SyncAdapter;
  /** Build-time metadata (e.g., versions, commit hashes). */
  envMetadata?: Record<string, string>;
  /** If true, generates the ephemeral identity immediately on boot (e.g., for collab links). */
  forceGuestMode?: boolean;
  /**
   * Default security policy for the engine.
   */
  securityMode?: SecurityMode;
  /**
   * Runtime log verbosity.
   */
  logLevel?: TractorLogLevel;
}

export type SecurityMode = "strict" | "permissive" | "none";
export type TractorLogLevel = "info" | "warn" | "error" | "debug" | "silent";

export interface TractorLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export const SILENT_LOGGER: TractorLogger = {
  info: () => {},
  warn: () => {},
  debug: () => {},
  error: () => {},
};

export const TRACTOR_LOG_PRIORITY: Record<TractorLogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

export function isTractorLogLevel(value: unknown): value is TractorLogLevel {
  return (
    value === "info" ||
    value === "warn" ||
    value === "error" ||
    value === "debug" ||
    value === "silent"
  );
}
