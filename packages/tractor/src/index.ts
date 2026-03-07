/**
 * @refarm/tractor
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

import type { IdentityAdapter } from "@refarm.dev/identity-contract-v1";
import type { PluginManifest } from "@refarm.dev/plugin-manifest";
import type { StorageAdapter } from "@refarm.dev/storage-contract-v1";
import type { SyncAdapter } from "@refarm.dev/sync-contract-v1";

// ─── Tractor Configuration ─────────────────────────────────────────────────────

export interface TractorConfig {
  /** The abstract storage mechanism (e.g., OPFS SQLite adapter). */
  storage: StorageAdapter;
  /** The user identity mechanism (e.g., Nostr Keypair adapter). */
  identity: IdentityAdapter;
  /** (Optional) Multi-device CRDT synchronization adapter. */
  sync?: SyncAdapter;
}

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
 * Plugins communicate with the Tractor exclusively through the WIT-defined
 * interface (see /wit/refarm-sdk.wit).  They never receive direct access to
 * the DOM, the network, or the SQLite connection.
 */
export class PluginHost {
  private _instances: Map<string, PluginInstance> = new Map();

  /**
   * Load and instantiate a WASM component plugin.
   *
   * @param manifest  The plugin's formal manifest containing entry point and capabilities.
   * @param wasmHash  Optional: Expected SHA-256 hex hash for integrity verification (if not in manifest).
   */
  async load(
    manifest: PluginManifest,
    wasmHash?: string,
  ): Promise<PluginInstance> {
    const pluginId = manifest.id;
    const wasmUrl = manifest.entry;
    const finalHash = wasmHash ?? (manifest as any).wasmHash ?? "placeholder"; // Future: Add hash to manifest spec if needed

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
        `[tractor] Failed to fetch plugin: ${response.statusText}`,
      );
    }
    const buffer = await response.arrayBuffer();

    // 2. Verify integrity before any instantiation
    const valid = await verifyWasmIntegrity(buffer, finalHash);
    if (!valid) {
      throw new Error(
        `[tractor] WASM integrity check failed for plugin ${pluginId}`,
      );
    }

    // 3. TODO: instantiate as a WASM Component via the Component Model API
    //    const component = await WebAssembly.instantiateStreaming(fetch(wasmUrl), imports);
    //    Wire up WIT-defined imports so the plugin can call tractor.store-node(), etc.

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

// ─── Tractor ───────────────────────────────────────────────────────────────────

export class Tractor {
  readonly storage: StorageAdapter;
  readonly identity: IdentityAdapter;
  readonly sync?: SyncAdapter;
  readonly plugins: PluginHost;

  private constructor(
    storage: StorageAdapter,
    identity: IdentityAdapter,
    sync?: SyncAdapter,
  ) {
    this.storage = storage;
    this.identity = identity;
    this.sync = sync;
    this.plugins = new PluginHost();
  }

  /**
   * Bootstrap the Tractor.
   *
   * Call this once at application startup (or in a Web Worker / Service Worker).
   */
  static async boot(config: TractorConfig): Promise<Tractor> {
    // 1. Validate mandatory adapters
    if (!config.storage) throw new Error("[tractor] A Storage Adapter is required to boot.");
    if (!config.identity) throw new Error("[tractor] An Identity Adapter is required to boot.");

    // 2. Initialize Core Schema (Delegated to adapter)
    await config.storage.ensureSchema();

    // 3. Start Sync if provided
    if (config.sync) {
      await config.sync.start();
    }

    console.info("[tractor] Booted ✓");
    return new Tractor(config.storage, config.identity, config.sync);
  }

  /**
   * Persist a normalised sovereign node to the local graph.
   */
  async storeNode(node: SovereignNode): Promise<void> {
    await this.storage.storeNode(
      node["@id"] as string,
      node["@type"],
      JSON.stringify(node["@context"]),
      JSON.stringify(node),
      (node["refarm:sourcePlugin"] as string | undefined) ?? null,
    );
  }

  /**
   * Retrieve all sovereign nodes of a given type.
   */
  async queryNodes<T extends SovereignNode = SovereignNode>(
    type: string,
  ): Promise<T[]> {
    const rows = await this.storage.queryNodes(type);
    return rows.map((r: { payload: string }) => JSON.parse(r.payload) as T);
  }

  async shutdown(): Promise<void> {
    this.plugins.terminateAll();
    await this.storage.close();
    console.info("[tractor] Shutdown ✓");
  }
}

export default Tractor;
