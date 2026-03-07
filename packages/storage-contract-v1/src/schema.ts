/**
 * PHYSICAL_SCHEMA_V1
 * 
 * Standard ANSI-SQL compatible table definitions for the Refarm Sovereign Graph.
 * 
 * Use these to initialize any SQL-based storage adapter (SQLite, PGlite, etc).
 */
export const PHYSICAL_SCHEMA_V1 = [
  // 0: sovereign data graph
  `CREATE TABLE IF NOT EXISTS nodes (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    context     TEXT NOT NULL DEFAULT 'https://schema.org/',
    payload     TEXT NOT NULL DEFAULT '{}',
    source_plugin TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  
  // 1: plugin registry cache
  `CREATE TABLE IF NOT EXISTS plugins (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    wasm_url    TEXT NOT NULL,
    wasm_hash   TEXT NOT NULL,
    version     TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    installed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  
  // 2: event log for CRDT operations
  `CREATE TABLE IF NOT EXISTS crdt_log (
    op_id       TEXT PRIMARY KEY,
    peer_id     TEXT NOT NULL,
    clock       TEXT NOT NULL,
    payload     TEXT NOT NULL,
    applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];
