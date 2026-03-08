/**
 * @refarm.dev/tractor
 *
 * Refarm Tractor — the heavy machinery that cultivates your personal "Solo Fértil"
 * by orchestrating plugins and adapters under a sovereign micro-kernel.
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
import { L8nHost } from "./lib/l8n-host";
import { AuthResponse, SecretAuthPrompt, SecretHost } from "./lib/secret-host";
export * from "./lib/l8n-host";
export * from "./lib/secret-host";

// ─── Tractor Configuration ─────────────────────────────────────────────────────

export interface TractorConfig {
  /** The abstract storage mechanism (e.g., OPFS SQLite adapter). */
  storage: StorageAdapter;
  /** The user identity mechanism (e.g., Nostr Keypair adapter). */
  identity: IdentityAdapter;
  /** (Optional) Multi-device CRDT synchronization adapter. */
  sync?: SyncAdapter;
  /** Callback for hardware/secret authentication prompts. */
  onAuthRequest?: (prompt: SecretAuthPrompt) => Promise<AuthResponse>;
  /** Build-time metadata (e.g., versions, commit hashes). */
  envMetadata?: Record<string, string>;
}

// ─── Engine Telemetry ──────────────────────────────────────────────────────────

/**
 * Internal pulse of the Tractor engine.
 */
export interface TelemetryEvent {
  event: string;
  pluginId?: string;
  durationMs?: number;
  payload?: any;
}

type TelemetryListener = (data: TelemetryEvent) => void;

class EventEmitter {
  private listeners: Set<TelemetryListener> = new Set();
  
  on(listener: TelemetryListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(data: TelemetryEvent) {
    this.listeners.forEach(l => l(data));
  }
}

// ─── Plugin Host ──────────────────────────────────────────────────────────────

export type PluginState = "idle" | "running" | "hot" | "throttled" | "error";

/**
 * A handle to a running WASM plugin instance.
 * The actual WASM component is loaded lazily via the Component Model / WASI.
 */
export interface PluginInstance {
  id: string;
  name: string;
  /** The plugin's formal manifest containing capabilities and API metadata. */
  manifest: PluginManifest;
  /** Call an exported function on the plugin (capability-gated). */
  call(fn: string, args?: unknown): Promise<unknown>;
  /** Terminate the plugin and release resources. */
  terminate(): void;
  /** Emit a telemetry event on behalf of the plugin. */
  emitTelemetry(event: string, payload?: any): void;
  /** Current lifecycle state of the plugin. */
  state: PluginState;
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

  constructor(private emit: (data: TelemetryEvent) => void) {}

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
    const startTime = performance.now();

    const finalHash = wasmHash ?? (manifest as any).wasmHash ?? "placeholder"; 

    // TODO: Replace with actual verifyWasmIntegrity import once @refarm.dev/identity-nostr is compiled
    const verifyWasmIntegrity = async (_buffer: ArrayBuffer, _hash: string): Promise<boolean> => {
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

    // JCO Integration Pattern:
    // In a real environment, we use 'transpile' to convert the component 
    // to a JS module that imports WASI.
    console.info(`[tractor] Loading component: ${pluginId} (via jco/wasi-p2)`);

    const instance: PluginInstance = {
      id: pluginId,
      name: manifest.name,
      manifest,
      call: async (fn, args) => {
        const callStart = performance.now();
        console.group(`[plugin:${pluginId}] call: ${fn}`);
        
        // Mocking the call dispatch to the transpiled component exports
        const result = null; 
        
        this.emit({
          event: "api:call",
          pluginId,
          durationMs: performance.now() - callStart,
          payload: { fn, args }
        });
        console.groupEnd();
        return result;
      },
      terminate: () => {
        this._instances.delete(pluginId);
        this.emit({ event: "plugin:terminate", pluginId });
      },
      emitTelemetry: (event: string, payload?: any) => {
        this.emit({
          event,
          pluginId,
          payload
        });
      },
      state: "running"
    };

    this._instances.set(pluginId, instance);

    // Bootstrap: trigger 'setup' exported function if it exists
    try {
      await instance.call("setup");
    } catch (err) {
      console.warn(`[tractor] Setup failed for plugin ${pluginId}:`, err);
    }

    this.emit({
      event: "plugin:load",
      pluginId,
      durationMs: performance.now() - startTime
    });
    
    return instance;
  }

  /**
   * Register a local/internal plugin instance (useful during migration/dev).
   */
  registerInternal(instance: PluginInstance) {
    if (!instance.state) instance.state = "running";
    this._instances.set(instance.id, instance);
    this.emit({ event: "plugin:load", pluginId: instance.id });
  }

  /**
   * Transition a plugin to a new lifecycle state.
   */
  setState(pluginId: string, state: PluginState) {
    const instance = this._instances.get(pluginId);
    if (instance && instance.state !== state) {
      instance.state = state;
      this.emit({
        event: "system:plugin_state_changed",
        pluginId,
        payload: { state }
      });
      console.info(`[tractor] Plugin ${pluginId} transitioned to ${state}`);
    }
  }

  /**
   * Dispatch a system event to all active plugins.
   */
  dispatch(event: TelemetryEvent) {
    for (const instance of this._instances.values()) {
      // We only forward "system:" events to prevent feedback loops
      if (event.event.startsWith("system:")) {
        instance.call("on-event", [event.event, JSON.stringify(event.payload)]);
      }
    }
  }

  /**
   * Aggregate help content from all loaded plugins.
   */
  async getHelpNodes(): Promise<SovereignNode[]> {
    const allHelp: SovereignNode[] = [];
    for (const plugin of this._instances.values()) {
      try {
        const nodes = await plugin.call("get-help-nodes") as any[];
        if (nodes) {
          allHelp.push(...nodes.map(n => JSON.parse(n)));
        }
      } catch (err) {
        console.warn(`[tractor] Failed to get help from plugin ${plugin.id}:`, err);
      }
    }
    return allHelp;
  }

  /**
   * Find a plugin instance that provides a specific API.
   */
  findByApi(apiName: string): PluginInstance | undefined {
    for (const instance of this._instances.values()) {
      if (instance.manifest.capabilities.providesApi?.includes(apiName)) {
        return instance;
      }
    }
    return undefined;
  }

  get(pluginId: string): PluginInstance | undefined {
    return this._instances.get(pluginId);
  }

  getAllPlugins(): PluginInstance[] {
    return Array.from(this._instances.values());
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

  const now = new Date().toISOString();

  return {
    ...raw,
    "@context": "https://schema.org/",
    "@type": type,
    "@id": id,
    "refarm:sourcePlugin": pluginId,
    "refarm:ingestedAt": now,
    "refarm:createdAt": (raw["refarm:createdAt"] as string) || now,
    "refarm:updatedAt": now,
    "refarm:clock": (raw["refarm:clock"] as number) || 0,
  };
}

// ─── Tractor ───────────────────────────────────────────────────────────────────

export class Tractor {
  static readonly VERSION = (import.meta as any).env?.VITE_REFARM_VERSION || "0.1.0-solo-fertil";
  readonly storage: StorageAdapter;
  readonly identity: IdentityAdapter;
  readonly sync?: SyncAdapter;
  readonly plugins: PluginHost;
  readonly secrets: SecretHost;
  readonly l8n: L8nHost;
  readonly envMetadata: Record<string, string>;
  private readonly events: EventEmitter = new EventEmitter();

  private constructor(
    storage: StorageAdapter,
    identity: IdentityAdapter,
    config: TractorConfig,
  ) {
    this.storage = storage;
    this.identity = identity;
    this.sync = config.sync;
    this.envMetadata = config.envMetadata || {};
    this.plugins = new PluginHost((data) => this.events.emit(data));
    this.l8n = new L8nHost();

    // Wire the Telemetry Bus to the Plugin Host for event-dispatching
    this.events.on((data) => {
      this.plugins.dispatch(data);
    });
    
    // Default auth provider that denies access unless overridden by the Shell
    const authProvider = config.onAuthRequest || (async () => {
      console.warn("[tractor] No secret auth provider configured. Access denied.");
      return { success: false };
    });
    
    this.secrets = new SecretHost(authProvider);
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
    return new Tractor(config.storage, config.identity, config);
  }

  /**
   * Subscribe to engine telemetry events.
   */
  observe(listener: TelemetryListener) {
    return this.events.on(listener);
  }

  /**
   * Transition a plugin to a new state.
   */
  setPluginState(pluginId: string, state: PluginState) {
    this.plugins.setState(pluginId, state);
  }

  /**
   * Emit a custom telemetry event (e.g. from the Shell).
   */
  emitTelemetry(data: TelemetryEvent) {
    this.events.emit(data);
  }

  /**
   * Discover a plugin that provides a specific API.
   */
  async getPluginApi(apiName: string): Promise<string | null> {
    const plugin = this.plugins.findByApi(apiName);
    return plugin ? plugin.id : null;
  }

  /**
   * Switches the identity/storage tier.
   * Emits a system event that the Shell should handle (e.g. by reloading).
   */
  async switchTier(tier: string): Promise<void> {
    console.info(`[tractor] Switching to tier: ${tier}`);
    this.events.emit({
      event: "system:switch-tier",
      payload: { tier }
    });
  }

  /**
   * Aggregate help nodes from core and all plugins.
   */
  async getHelpNodes(): Promise<SovereignNode[]> {
    const pluginHelp = await this.plugins.getHelpNodes();
    return [this.getSeedNode(), ...pluginHelp];
  }

  /**
   * Returns the "mínimo existencial" node for the engine.
   * This powers the Visitor / Static-First experience.
   */
  getSeedNode(): SovereignNode {
    return {
      "@context": "https://schema.org/",
      "@type": "HelpPage",
      "@id": "urn:refarm:core:seed",
      "name": "Sovereign Engine",
      "text": "The engine is active. You are currently in Visitor Mode. Experience plugins can be cultivated to expand this soil.",
      "refarm:sourcePlugin": "core",
      "refarm:priority": 0,
      "refarm:renderType": "landing"
    };
  }

  /**
   * Persist a normalised sovereign node to the local graph.
   */
  async storeNode(node: SovereignNode): Promise<void> {
    const startTime = performance.now();
    await this.storage.storeNode(
      node["@id"] as string,
      node["@type"],
      JSON.stringify(node["@context"]),
      JSON.stringify(node),
      (node["refarm:sourcePlugin"] as string | undefined) ?? null,
    );
    this.events.emit({
      event: "storage:io",
      pluginId: (node["refarm:sourcePlugin"] as string | undefined),
      durationMs: performance.now() - startTime,
      payload: { type: node["@type"], action: "store" }
    });
  }

  /**
   * Retrieve all sovereign nodes of a given type.
   */
  async queryNodes<T extends SovereignNode = SovereignNode>(
    type: string,
  ): Promise<T[]> {
    const startTime = performance.now();
    const rows = await this.storage.queryNodes(type);
    const nodes = rows.map((r: { payload: string }) => JSON.parse(r.payload) as T);
    this.events.emit({
      event: "storage:io",
      durationMs: performance.now() - startTime,
      payload: { type, action: "query", count: nodes.length }
    });
    return nodes;
  }

  async shutdown(): Promise<void> {
    this.plugins.terminateAll();
    await this.secrets.lock();
    await this.storage.close();
    console.info("[tractor] Shutdown ✓");
  }
}

export default Tractor;
