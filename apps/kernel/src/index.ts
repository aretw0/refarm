/**
 * @refarm/kernel
 *
 * The "Solo Fértil" — the fertile soil kernel of the Refarm platform.
 *
 * Responsibilities:
 *   1. Bootstrap the local SQLite/OPFS database.
 *   2. Manage user identity via Nostr keys.
 *   3. Host the WASM plugin sandbox and enforce the WIT capability contract.
 *   4. Normalise incoming plugin data to the sovereign JSON-LD graph before
 *      persisting to SQLite.
 *   5. Coordinate CRDT-based sync across devices (optional / offline-first).
 *
 * "If Refarm disappears, every primitive keeps working on its own."
 */

// TODO: Resolve workspace package imports once @refarm/* packages export compiled type definitions.
// See: tsconfig.json "paths" configuration and workspace "references"
// import type { StorageAdapter } from "@refarm/storage-sqlite";
// import OPFSSQLiteAdapter, { runMigrations } from "@refarm/storage-sqlite";
// import NostrIdentityManager from "@refarm/identity-nostr";
// import SyncEngine from "@refarm/sync-crdt";

// Stub types for development (replace with actual imports once packages are compiled)
type StorageAdapter = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const OPFSSQLiteAdapter: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
const runMigrations: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
const NostrIdentityManager: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
const SyncEngine: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any

// ─── Kernel Configuration ─────────────────────────────────────────────────────

export interface KernelConfig {
  /** Logical database name (maps to an OPFS file). */
  dbName?: string;
  /** Nostr relay URLs for plugin discovery and sync. */
  nostrRelays?: string[];
  /** Enable CRDT-based multi-device sync. */
  syncEnabled?: boolean;
}

const DEFAULT_CONFIG: Required<KernelConfig> = {
  dbName: "refarm",
  nostrRelays: [
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://relay.nostr.band",
  ],
  syncEnabled: false,
};

// ─── Core Schema Migrations ───────────────────────────────────────────────────

/**
 * Ordered SQL migration statements applied on first launch and on upgrades.
 * New migrations are appended — never modify existing entries.
 */
const CORE_MIGRATIONS: string[] = [
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

// ─── Plugin Host ──────────────────────────────────────────────────────────────

/**
 * A handle to a running WASM plugin instance.
 * The actual WASM component is loaded lazily via the Component Model / WASI.
 */
export interface PluginInstance {
  id: string;
  name: string;
  /** Call an exported function on the plugin (capability-gated). */
  call(fn: string, args?: unknown): Promise<unknown>;
  /** Terminate the plugin and release resources. */
  terminate(): void;
}

/**
 * Sandboxed plugin host.
 *
 * Plugins communicate with the Kernel exclusively through the WIT-defined
 * interface (see /wit/refarm-sdk.wit).  They never receive direct access to
 * the DOM, the network, or the SQLite connection.
 */
export class PluginHost {
  private _instances: Map<string, PluginInstance> = new Map();

  /**
   * Load and instantiate a WASM component plugin.
   *
   * @param wasmUrl   URL of the WASM binary (verified via wasm_hash before exec).
   * @param wasmHash  Expected SHA-256 hex hash for integrity verification.
   * @param pluginId  Stable identifier (e.g. Nostr event id of the handler).
   */
  async load(
    wasmUrl: string,
    wasmHash: string,
    pluginId: string,
  ): Promise<PluginInstance> {
    // TODO: Replace with actual verifyWasmIntegrity import once @refarm/identity-nostr is compiled
    // const { verifyWasmIntegrity } = await import("@refarm/identity-nostr");
    const verifyWasmIntegrity = async (_buffer: ArrayBuffer, _hash: string): Promise<boolean> => {
      // Stub: always return true for development
      console.debug("[kernel] WASM integrity check (stub - not validated)");
      return true;
    };

    // 1. Fetch the WASM binary
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      throw new Error(
        `[kernel] Failed to fetch plugin: ${response.statusText}`,
      );
    }
    const buffer = await response.arrayBuffer();

    // 2. Verify integrity before any instantiation
    const valid = await verifyWasmIntegrity(buffer, wasmHash);
    if (!valid) {
      throw new Error(
        `[kernel] WASM integrity check failed for plugin ${pluginId}`,
      );
    }

    // 3. TODO: instantiate as a WASM Component via the Component Model API
    //    const component = await WebAssembly.instantiateStreaming(fetch(wasmUrl), imports);
    //    Wire up WIT-defined imports so the plugin can call kernel.store-node(), etc.

    const instance: PluginInstance = {
      id: pluginId,
      name: pluginId,
      call: async (fn, args) => {
        console.info(`[plugin:${pluginId}] calling ${fn}`, args);
        return null;
      },
      terminate: () => {
        this._instances.delete(pluginId);
      },
    };

    this._instances.set(pluginId, instance);
    return instance;
  }

  get(pluginId: string): PluginInstance | undefined {
    return this._instances.get(pluginId);
  }

  terminateAll(): void {
    for (const inst of this._instances.values()) inst.terminate();
  }
}

// ─── Sovereign Graph Normaliser ───────────────────────────────────────────────

/**
 * Normalise raw data from a plugin into a sovereign JSON-LD node before
 * writing it to the local SQLite graph.
 *
 * This ensures that even if the originating plugin/service disappears, the data
 * remains machine-readable and semantically portable.
 *
 * See /schemas/sovereign-graph.jsonld for the full schema example.
 */
export interface SovereignNode {
  "@context": string | Record<string, string>;
  "@type": string;
  "@id": string;
  [key: string]: unknown;
}

export function normaliseToSovereignGraph(
  raw: Record<string, unknown>,
  pluginId: string,
  type: string,
): SovereignNode {
  const id =
    (raw["@id"] as string | undefined) ??
    `urn:refarm:${pluginId}:${crypto.randomUUID()}`;

  return {
    "@context": "https://schema.org/",
    "@type": type,
    "@id": id,
    "refarm:sourcePlugin": pluginId,
    "refarm:ingestedAt": new Date().toISOString(),
    ...raw,
  };
}

// ─── Kernel ───────────────────────────────────────────────────────────────────

export class Kernel {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly storage: StorageAdapter | any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly identity: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly sync: any;
  readonly plugins: PluginHost;

  private constructor(
    storage: StorageAdapter | any, // eslint-disable-line @typescript-eslint/no-explicit-any
    identity: any, // eslint-disable-line @typescript-eslint/no-explicit-any
    sync: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  ) {
    this.storage = storage;
    this.identity = identity;
    this.sync = sync;
    this.plugins = new PluginHost();
  }

  /**
   * Bootstrap the Kernel.
   *
   * Call this once at application startup (or in a Web Worker / Service Worker).
   */
  static async boot(config: KernelConfig = {}): Promise<Kernel> {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    // 1. Storage
    const storage = await new OPFSSQLiteAdapter().open(cfg.dbName);
    await runMigrations(storage, CORE_MIGRATIONS);

    // 2. Identity
    const identity = new NostrIdentityManager();
    // TODO: load saved keypair from encrypted storage

    // 3. Sync (optional)
    const sync = new SyncEngine(identity.publicKey ?? "anonymous");
    if (cfg.syncEnabled) {
      // TODO: attach NostrSyncTransport(cfg.nostrRelays)
    }

    console.info("[kernel] Booted ✓");
    return new Kernel(storage, identity, sync);
  }

  /**
   * Persist a normalised sovereign node to the local graph.
   */
  async storeNode(node: SovereignNode): Promise<void> {
    await this.storage.execute(
      `INSERT OR REPLACE INTO nodes (id, type, context, payload, source_plugin)
       VALUES (?, ?, ?, ?, ?)`,
      {
        params: [
          node["@id"] as string,
          node["@type"],
          JSON.stringify(node["@context"]),
          JSON.stringify(node),
          (node["refarm:sourcePlugin"] as string | undefined) ?? null,
        ],
      },
    );
  }

  /**
   * Retrieve all sovereign nodes of a given type.
   */
  async queryNodes<T extends SovereignNode = SovereignNode>(
    type: string,
  ): Promise<T[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await (this.storage as any).query(
      "SELECT payload FROM nodes WHERE type = ? ORDER BY created_at DESC",
      { params: [type] },
    );
    return rows.map((r: { payload: string }) => JSON.parse(r.payload) as T);
  }

  async shutdown(): Promise<void> {
    this.plugins.terminateAll();
    await this.storage.close();
    console.info("[kernel] Shutdown ✓");
  }
}

export default Kernel;
