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

import * as ed from "@noble/ed25519";
import { IdentityAdapter } from "@refarm.dev/identity-contract-v1";
import { PluginManifest } from "@refarm.dev/plugin-manifest";
import { StorageAdapter } from "@refarm.dev/storage-contract-v1";
import { SyncAdapter } from "@refarm.dev/sync-contract-v1";
import { CommandHost } from "./lib/command-host";
import { EventEmitter, TelemetryEvent, TelemetryHost, TelemetryListener } from "./lib/telemetry";
export * from "./lib/identity-recovery-host";
export * from "./lib/l8n-host";
export * from "./lib/secret-host";
export * from "./lib/telemetry";

// ─── Tractor Configuration ─────────────────────────────────────────────────────

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
   * strict (default): verify all, sign all, throw on canary trip.
   * permissive: sign all, warn on canary but don't block.
   * none: skip signing and verification (high performance, e.g. for games).
   */
  securityMode?: SecurityMode;
  /**
   * Runtime log verbosity.
   * info (default): info, warn, error
   * warn: warn, error
   * error: error only
   * silent: disable Tractor runtime logs
   */
  logLevel?: TractorLogLevel;
}

export type SecurityMode = "strict" | "permissive" | "none";
export type TractorLogLevel = "info" | "warn" | "error" | "silent";

interface TractorLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

const TRACTOR_LOG_PRIORITY: Record<TractorLogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
};

function isTractorLogLevel(value: unknown): value is TractorLogLevel {
  return value === "info" || value === "warn" || value === "error" || value === "silent";
}

function resolveDefaultLogLevel(configLevel?: TractorLogLevel): TractorLogLevel {
  if (configLevel) return configLevel;

  const env = (globalThis as any)?.process?.env as Record<string, string | undefined> | undefined;
  const envLevel = env?.REFARM_LOG_LEVEL;
  if (isTractorLogLevel(envLevel)) return envLevel;

  // Keep test output clean by default.
  if (env?.VITEST === "true" || env?.NODE_ENV === "test") {
    return "silent";
  }

  return "info";
}

// ─── Engine Telemetry ──────────────────────────────────────────────────────────
// Moved to src/lib/telemetry.ts

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

export interface PluginTrustGrant {
  pluginId: string;
  wasmHash: string;
  grantedAt: number;
  expiresAt?: number;
}

type ExecutionProfile = "strict" | "trusted-fast";

/**
 * Sandboxed plugin host.
 *
 * Plugins communicate with the Tractor exclusively through the WIT-defined
 * interface (see /wit/refarm-sdk.wit).
 *
 * Standard WASI calls (wasi:http, wasi:logging) are intercepted here to enforce
 * the Refarm capability model.
 */
export class PluginHost {
  private _instances: Map<string, PluginInstance> = new Map();
  private readonly trustGrants: Map<string, PluginTrustGrant> = new Map();

  constructor(
    private emit: (data: TelemetryEvent) => void,
    private logger: TractorLogger = console,
  ) {}

  private getTrustKey(pluginId: string, wasmHash: string): string {
    return `${pluginId}::${wasmHash}`;
  }

  private hasValidTrustGrant(pluginId: string, wasmHash?: string): boolean {
    if (!wasmHash) return false;
    const key = this.getTrustKey(pluginId, wasmHash);
    const grant = this.trustGrants.get(key);
    if (!grant) return false;
    if (grant.expiresAt && Date.now() > grant.expiresAt) {
      this.trustGrants.delete(key);
      return false;
    }
    return true;
  }

  private getGrantsForPlugin(pluginId: string): PluginTrustGrant[] {
    const prefix = `${pluginId}::`;
    const grants: PluginTrustGrant[] = [];
    for (const [key, grant] of this.trustGrants.entries()) {
      if (key.startsWith(prefix)) {
        grants.push(grant);
      }
    }
    return grants;
  }

  private resolveExecutionProfile(
    manifest: PluginManifest,
    wasmHash?: string,
  ): ExecutionProfile {
    const trust = (
      manifest as PluginManifest & { trust?: { profile?: ExecutionProfile } }
    ).trust;
    const requestedProfile: ExecutionProfile = trust?.profile ?? "strict";
    if (requestedProfile !== "trusted-fast") {
      return "strict";
    }

    return this.hasValidTrustGrant(manifest.id, wasmHash)
      ? "trusted-fast"
      : "strict";
  }

  grantTrust(
    pluginId: string,
    wasmHash: string,
    leaseMs?: number,
  ): PluginTrustGrant {
    const now = Date.now();
    const grant: PluginTrustGrant = {
      pluginId,
      wasmHash,
      grantedAt: now,
      expiresAt: leaseMs ? now + leaseMs : undefined,
    };
    this.trustGrants.set(this.getTrustKey(pluginId, wasmHash), grant);
    this.emit({
      event: "plugin:trust_granted",
      pluginId,
      payload: {
        wasmHash,
        expiresAt: grant.expiresAt,
      },
    });
    return grant;
  }

  trustManifestOnce(
    manifest: PluginManifest,
    wasmHash: string,
  ): PluginTrustGrant {
    const trust = (
      manifest as PluginManifest & { trust?: { leaseHours?: number } }
    ).trust;
    const leaseMs = trust?.leaseHours
      ? trust.leaseHours * 60 * 60 * 1000
      : undefined;
    return this.grantTrust(manifest.id, wasmHash, leaseMs);
  }

  revokeTrust(pluginId: string, wasmHash?: string): void {
    if (wasmHash) {
      this.trustGrants.delete(this.getTrustKey(pluginId, wasmHash));
    } else {
      for (const key of this.trustGrants.keys()) {
        if (key.startsWith(`${pluginId}::`)) {
          this.trustGrants.delete(key);
        }
      }
    }
    this.emit({
      event: "plugin:trust_revoked",
      pluginId,
      payload: { wasmHash },
    });
  }

  /**
   * Internal WASI Interceptor.
   * Redirects standard WASI calls to capability-gated host logic.
   */
  private getWasiImports(manifest: PluginManifest, profile: ExecutionProfile) {
    const allowedOrigins = manifest.capabilities.allowedOrigins ?? [];
    const isTrustedFast = profile === "trusted-fast";

    const isAllowedRequest = (request: unknown): boolean => {
      if (isTrustedFast) {
        return true;
      }

      if (allowedOrigins.length === 0) {
        return false;
      }

      const url =
        typeof request === "string"
          ? request
          : (request as { url?: string })?.url;
      if (!url) {
        return false;
      }

      return allowedOrigins.some((origin: string) => url.startsWith(origin));
    };

    return {
      "wasi:logging/logging": {
        log: (level: string, context: string, message: string) => {
          if (!isTrustedFast) {
            this.logger.debug(`[plugin:${manifest.id}] [${level}] ${message}`);
          }
          this.emit({
            event: "plugin:log",
            pluginId: manifest.id,
            payload: { level, message },
          });
        },
      },
      "wasi:http/outgoing-handler": {
        handle: async (request: any) => {
          if (!isAllowedRequest(request)) {
            const url = typeof request === "string" ? request : request?.url;
            console.warn(
              `[tractor] Blocked unauthorized fetch to ${url || "<unknown>"} by ${manifest.id}`,
            );
            throw new Error("HTTP request not permitted by capabilities");
          }

          return fetch(request);
        },
      },
      "refarm:plugin/tractor-bridge": {
        "store-node": async (nodeJson: string) => {
          // Capability check: can this plugin store this type?
          // (Implementation deferred to Tractor.storeNode logic)
          return "node-id-stub";
        },
        "request-permission": async (cap: string, reason: string) => {
          console.debug(
            `[tractor] Permission request by ${manifest.id}: ${cap} (${reason})`,
          );
          return true; // Stub: auto-accept in dev
        },
      },
    };
  }

  /**
   * Load and instantiate a WASM component plugin.
   */
  async load(
    manifest: PluginManifest,
    wasmHash?: string,
  ): Promise<PluginInstance> {
    const pluginId = manifest.id;
    const wasmUrl = manifest.entry;
    const startTime = performance.now();

    const profile = this.resolveExecutionProfile(manifest, wasmHash);
    const trust = (
      manifest as PluginManifest & { trust?: { profile?: ExecutionProfile } }
    ).trust;
    if (trust?.profile === "trusted-fast" && !wasmHash) {
      throw new Error(
        `[tractor] Trusted-fast requires wasmHash for ${pluginId}.`,
      );
    }

    if (trust?.profile === "trusted-fast" && wasmHash) {
      const grants = this.getGrantsForPlugin(pluginId);
      const hasGrantForCurrentHash = grants.some(
        (grant) => grant.wasmHash === wasmHash,
      );
      if (grants.length > 0 && !hasGrantForCurrentHash) {
        // Fingerprint changed: revoke stale grants and force explicit re-trust.
        this.revokeTrust(pluginId);
        throw new Error(
          `[tractor] Trusted-fast revoked for ${pluginId}: wasm hash changed. Re-grant trust for the new binary.`,
        );
      }
    }

    if (trust?.profile === "trusted-fast" && profile !== "trusted-fast") {
      throw new Error(
        `[tractor] Trusted-fast denied for ${pluginId}. Grant trust for this wasm hash before loading.`,
      );
    }

    // Fetch and validate WASM module
    this.logger.debug(`[tractor] Fetching plugin WASM: ${wasmUrl}`);
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      throw new Error(
        `[tractor] Failed to fetch plugin: ${response.statusText}`,
      );
    }
    const wasmBuffer = await response.arrayBuffer();
    this.logger.debug(
      `[tractor] WASM loaded: ${(wasmBuffer.byteLength / 1024).toFixed(2)} KB`,
    );

    // JCO Integration Logic (Component Model WASM)
    const imports = this.getWasiImports(manifest, profile);
    const modeLabel =
      profile === "trusted-fast" ? "TRUSTED FAST PATH" : "strict path";
    this.logger.debug(
      `[tractor] Instantiating ${pluginId} with WASI Interceptor (${modeLabel})...`,
    );

    // TODO: Real Component Model instantiation via JCO transpile + WebAssembly.instantiate
    // Currently using mock; awaiting plugin-compiler integration.
    // When available:
    //   1. Transpile WASM via jco.transpile() to get JS binding + typed interface
    //   2. Instantiate via WebAssembly.instantiate(wasmBuffer, { env: imports })
    //   3. Extract exported functions from component instance
    // Note: WebAssembly not available in Node.js test environment; tests use mocks.

    const instance: PluginInstance = {
      id: pluginId,
      name: manifest.name,
      manifest,
      call: async (fn, args) => {
        const callStart = performance.now();
        this.logger.debug(`[plugin:${pluginId}] call: ${fn}`);

        // Mock implementation: return null
        // Real implementation will dispatch to ComponentInstance[fn](...args)
        const result = null;

        this.emit({
          event: "api:call",
          pluginId,
          durationMs: performance.now() - callStart,
          payload: { fn, args, result },
        });
        this.logger.debug(`[plugin:${pluginId}] call end: ${fn}`);
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
          payload,
        });
      },
      state: "running",
    };

    this._instances.set(pluginId, instance);

    try {
      await instance.call("setup");
    } catch (err) {
      this.logger.warn(`[tractor] Setup failed for plugin ${pluginId}:`, err);
    }

    this.emit({
      event: "plugin:load",
      pluginId,
      durationMs: performance.now() - startTime,
      payload: { profile, wasmHash },
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
        payload: { state },
      });
      this.logger.debug(`[tractor] Plugin ${pluginId} transitioned to ${state}`);
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
        const nodes = (await plugin.call("get-help-nodes")) as any[];
        if (nodes) {
          allHelp.push(...nodes.map((n) => JSON.parse(n)));
        }
      } catch (err) {
        console.warn(
          `[tractor] Failed to get help from plugin ${plugin.id}:`,
          err,
        );
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
  "refarm:signature"?: SovereignSignature;
  "refarm:signatures"?: SovereignSignature[];
  [key: string]: unknown;
}

export interface SovereignSignature {
  pubkey: string;
  sig: string;
  alg: string;
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
  static readonly VERSION =
    (import.meta as any).env?.VITE_REFARM_VERSION || "0.1.0-solo-fertil";
  readonly storage: StorageAdapter;
  readonly namespace: string;
  identity: IdentityAdapter;
  readonly sync?: SyncAdapter;
  readonly plugins: PluginHost;
  readonly envMetadata: Record<string, string>;
  readonly commands: CommandHost;
  readonly defaultSecurityMode: SecurityMode;
  readonly logLevel: TractorLogLevel;
  readonly telemetry: TelemetryHost;

  /** Ephemeral identity used for signing during Guest/Visitor sessions. */
  private _ephemeralKeypair?: { publicKey: Uint8Array; secretKey: Uint8Array };

  private readonly events: EventEmitter = new EventEmitter();

  private constructor(
    storage: StorageAdapter,
    identity: IdentityAdapter,
    config: TractorConfig,
  ) {
    this.storage = storage;
    this.namespace = config.namespace;
    this.identity = identity;
    this.sync = config.sync;
    this.envMetadata = config.envMetadata || {};
    this.defaultSecurityMode = config.securityMode || "strict";
    this.logLevel = resolveDefaultLogLevel(config.logLevel);
    this.plugins = new PluginHost(
      (data) => this.events.emit(data),
      {
        info: (...args: unknown[]) => this.logInfo(...args),
        warn: (...args: unknown[]) => this.logWarn(...args),
        debug: (...args: unknown[]) => this.logDebug(...args),
      },
    );
    this.telemetry = new TelemetryHost({ capacity: 1000 });

    this.commands = new CommandHost((event: string, payload: any) =>
      this.events.emit({ event, payload }),
    );

    // Wire the Telemetry Bus to components
    this.telemetry.register(this.events, this.commands);

    this.events.on((data) => {
      this.plugins.dispatch(data);
    });

    this.registerCoreCommands();

    // Immediate generation IF requested (Collab/High-Trust)
    if (config.forceGuestMode) {
      this.initializeEphemeralIdentity();
    }
  }

  private registerCoreCommands() {
    this.commands.register({
      id: "system:identity:guest",
      title: "Enter Guest Mode",
      category: "Identity",
      description: "Generate an ephemeral identity for signing.",
      handler: () => this.enableGuestMode(),
    });

    this.commands.register({
      id: "system:identity:debug",
      title: "Show Current Identity",
      category: "Identity",
      handler: () => ({
        publicKey: this._ephemeralKeypair
          ? this.uint8ToHex(this._ephemeralKeypair.publicKey)
          : this.identity.publicKey,
        type: this._ephemeralKeypair ? "guest" : "permanent",
      }),
    });



    this.commands.register({
      id: "system:security:trust-plugin",
      title: "Trust Plugin Binary",
      category: "Security",
      description: "Grant trusted-fast execution for a plugin fingerprint.",
      handler: (args: {
        pluginId: string;
        wasmHash: string;
        leaseMs?: number;
      }) => {
        if (!args?.pluginId || !args?.wasmHash) {
          throw new Error("pluginId and wasmHash are required");
        }
        return this.trustPlugin(args.pluginId, args.wasmHash, args.leaseMs);
      },
    });

    this.commands.register({
      id: "system:security:trust-plugin-once",
      title: "Trust This Plugin Once",
      category: "Security",
      description:
        "One-time high-performance trust grant with explicit user acknowledgment.",
      handler: (args: {
        manifest: PluginManifest;
        wasmHash: string;
        acknowledgeRisk: boolean;
      }) => {
        if (!args?.manifest || !args?.wasmHash) {
          throw new Error("manifest and wasmHash are required");
        }
        if (!args.acknowledgeRisk) {
          throw new Error(
            "Risk acknowledgment is required for trusted-fast mode",
          );
        }

        const trust = (
          args.manifest as PluginManifest & { trust?: { profile?: string } }
        ).trust;
        if (trust?.profile !== "trusted-fast") {
          throw new Error("manifest trust.profile must be trusted-fast");
        }

        const grant = this.trustPluginManifestOnce(
          args.manifest,
          args.wasmHash,
        );
        return {
          grant,
          warning:
            "Trusted-fast enabled for this binary fingerprint. Plugin publisher assumes responsibility for host-impacting behavior.",
        };
      },
    });

    this.commands.register({
      id: "system:security:revoke-plugin-trust",
      title: "Revoke Plugin Trust",
      category: "Security",
      description:
        "Revoke trusted-fast execution for a plugin fingerprint or all plugin grants.",
      handler: (args: { pluginId: string; wasmHash?: string }) => {
        if (!args?.pluginId) {
          throw new Error("pluginId is required");
        }
        this.revokePluginTrust(args.pluginId, args.wasmHash);
        return { ok: true };
      },
    });
  }



  private shouldLog(level: "info" | "warn" | "error"): boolean {
    return TRACTOR_LOG_PRIORITY[this.logLevel] >= TRACTOR_LOG_PRIORITY[level];
  }

  private logInfo(...args: unknown[]): void {
    if (this.shouldLog("info")) console.info(...args);
  }

  private logWarn(...args: unknown[]): void {
    if (this.shouldLog("warn")) console.warn(...args);
  }

  private logDebug(...args: unknown[]): void {
    if (this.shouldLog("info")) console.debug(...args);
  }

  /**
   * Transition from Visitor to Guest Mode.
   * Generates an ephemeral keypair for non-committal data signing.
   *
   * @returns The hex-encoded public key of the guest identity.
   */
  async enableGuestMode(): Promise<string> {
    if (this._ephemeralKeypair)
      return this.uint8ToHex(this._ephemeralKeypair.publicKey);

    await this.initializeEphemeralIdentity();
    return this.uint8ToHex(this._ephemeralKeypair!.publicKey);
  }

  private async initializeEphemeralIdentity() {
    const privKey = ed.utils.randomSecretKey();
    const pubKey = await ed.getPublicKeyAsync(privKey);
    this._ephemeralKeypair = { publicKey: pubKey, secretKey: privKey };

    this.logInfo(
      `[tractor] Ephemeral Identity initialized: ${this.uint8ToHex(pubKey)}`,
    );
    this.events.emit({
      event: "identity:ephemeral_ready",
      payload: { publicKey: this.uint8ToHex(pubKey) },
    });
  }

  private uint8ToHex(arr: Uint8Array): string {
    return Array.from(arr)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  private hexToUint8(hex: string): Uint8Array {
    const matches = hex.match(/.{1,2}/g);
    if (!matches) return new Uint8Array();
    return new Uint8Array(matches.map((byte) => parseInt(byte, 16)));
  }

  /**
   * Cryptographically verify a node's signature.
   */
  async verifyNode(node: SovereignNode): Promise<boolean> {
    const signature = node["refarm:signature"];
    if (!signature) return false;

    if (signature.alg === "external" && signature.sig === "delegated")
      return true;
    if (signature.alg !== "ed25519") return false;

    try {
      // Reconstruct the data that was signed
      // We must remove the signature(s) added by signNode()
      const {
        "refarm:signature": _s,
        "refarm:signatures": _ss,
        ...unsignedNode
      } = node;
      const data = new TextEncoder().encode(JSON.stringify(unsignedNode));

      const sig = this.hexToUint8(signature.sig);
      const pub = this.hexToUint8(signature.pubkey);

      return await ed.verifyAsync(sig, data, pub);
    } catch (e) {
      return false;
    }
  }

  /**
   * Bootstrap the Tractor.
   *
   * Call this once at application startup (or in a Web Worker / Service Worker).
   */
  static async boot(config: TractorConfig): Promise<Tractor> {
    // 1. Validate mandatory adapters
    if (!config.storage)
      throw new Error("[tractor] A Storage Adapter is required to boot.");
    if (!config.identity)
      throw new Error("[tractor] An Identity Adapter is required to boot.");

    // 2. Initialize Core Schema (Delegated to adapter)
    // In multi-vault mode, the adapter returns a scoped/isolated instance
    if ((config.storage as any).open) {
      config.storage = await (config.storage as any).open(config.namespace);
    }
    await config.storage.ensureSchema();

    // 3. Start Sync if provided
    if (config.sync) {
      await config.sync.start();
    }

    const tractor = new Tractor(config.storage, config.identity, config);
    tractor.logInfo(`[tractor:${config.namespace}] Booted ✓`);
    return tractor;
  }

  /**
   * Spawns a child Tractor in a new isolated vault.
   * Hierarchical orchestration as defined in ADR-041.
   */
  async spawnChild(namespace: string, configOverrides: Partial<TractorConfig> = {}): Promise<Tractor> {
    this.logInfo(`[tractor:${this.namespace}] Spawning child vault: ${namespace}`);
    
    const childConfig: TractorConfig = {
      ...configOverrides,
      namespace,
      // If no storage provided, we try to reuse the parent's storage class but with new namespace
      storage: configOverrides.storage || this.storage, 
      identity: configOverrides.identity || this.identity,
      logLevel: configOverrides.logLevel || this.logLevel,
      securityMode: configOverrides.securityMode || this.defaultSecurityMode,
    };

    return await Tractor.boot(childConfig);
  }

  /**
   * Subscribe to engine telemetry events.
   */
  observe(listener: TelemetryListener) {
    return this.events.on(listener);
  }

  /**
   * Grant trusted-fast execution for a specific plugin binary fingerprint.
   * The grant is keyed by plugin id + wasm hash and can be optionally time-boxed.
   */
  trustPlugin(
    pluginId: string,
    wasmHash: string,
    leaseMs?: number,
  ): PluginTrustGrant {
    return this.plugins.grantTrust(pluginId, wasmHash, leaseMs);
  }

  trustPluginManifestOnce(
    manifest: PluginManifest,
    wasmHash: string,
  ): PluginTrustGrant {
    return this.plugins.trustManifestOnce(manifest, wasmHash);
  }

  /**
   * Revoke trusted-fast execution grant(s) for a plugin.
   */
  revokePluginTrust(pluginId: string, wasmHash?: string): void {
    this.plugins.revokeTrust(pluginId, wasmHash);
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
   * Connect a permanent identity (e.g. from Nostr).
   * This replaces the current identity adapter and clears any ephemeral session.
   *
   * If transitioning from Guest to Permanent, it generates an 'IdentityConversion' node
   * as defined in ADR-034 to maintain cryptographic ownership links.
   */
  async connectIdentity(adapter: IdentityAdapter): Promise<void> {
    const previousGuestKey = this._ephemeralKeypair;
    const permanentPubKey = adapter.publicKey;

    this.logInfo(
      `[tractor] Connecting new identity: ${permanentPubKey || "unknown"}`,
    );

    // 1. If we were in Guest Mode, create the Conversion Link
    if (previousGuestKey && permanentPubKey) {
      this.logInfo(
        "[tractor] Transitioning Guest -> Permanent. Generating IdentityConversion node...",
      );

      const conversionNode: SovereignNode = {
        "@context": "https://refarm.dev/schemas/v1",
        "@type": "IdentityConversion",
        "@id": `urn:refarm:identity:conversion:${this.uint8ToHex(previousGuestKey.publicKey)}`,
        guestPubkey: this.uint8ToHex(previousGuestKey.publicKey),
        permanentPubkey: permanentPubKey,
        timestamp: new Date().toISOString(),
      };

      // Signature 1: By the Guest Key (Proving voluntary transfer)
      const guestSignedNode = await this.signNodeWithKeypair(
        conversionNode,
        previousGuestKey,
      );

      // Update identity to permanent
      this.identity = adapter;
      this._ephemeralKeypair = undefined;

      // Signature 2: By the Permanent Key (Proving acceptance)
      // Note: signNode now uses this.identity since _ephemeralKeypair is cleared
      const doubleSignedNode = await this.signNode(guestSignedNode);

      // Persist the link
      await this.storage.storeNode(
        doubleSignedNode["@id"] as string,
        doubleSignedNode["@type"] as string,
        doubleSignedNode["@context"] as string,
        JSON.stringify(doubleSignedNode),
        "system:identity",
      );

      this.logInfo("[tractor] IdentityConversation node persisted ✓");
    } else {
      this.identity = adapter;
      this._ephemeralKeypair = undefined;
    }

    this.events.emit({
      event: "identity:connected",
      payload: { publicKey: adapter.publicKey },
    });
  }

  /**
   * Internal helper to sign a node with a specific keypair (ignoring current state).
   */
  private async signNodeWithKeypair(
    node: SovereignNode,
    keypair: { publicKey: Uint8Array; secretKey: Uint8Array },
  ): Promise<SovereignNode> {
    const nodeData = JSON.stringify(node);
    const signature = await ed.signAsync(
      new TextEncoder().encode(nodeData),
      keypair.secretKey,
    );

    return {
      ...node,
      "refarm:signature": {
        pubkey: this.uint8ToHex(keypair.publicKey),
        sig: this.uint8ToHex(signature),
        alg: "ed25519",
      },
    };
  }

  /**
   * Switches the identity/storage tier.
   * Emits a system event that the Shell should handle (e.g. by reloading).
   */
  async switchTier(tier: string): Promise<void> {
    this.logInfo(`[tractor] Switching to tier: ${tier}`);
    this.events.emit({
      event: "system:switch-tier",
      payload: { tier },
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
      name: "Sovereign Engine",
      text: "The engine is active. You are currently in Visitor Mode. Experience plugins can be cultivated to expand this soil.",
      "refarm:sourcePlugin": "core",
      "refarm:priority": 0,
      "refarm:renderType": "landing",
    };
  }

  /**
   * Persist a normalised sovereign node to the local graph.
   *
   * Includes 'Security Canaries' (tripwires) to detect tampering or clock attacks.
   * Can be overridden by the caller for high-performance needs (e.g. games).
   */
  async storeNode(node: SovereignNode, mode?: SecurityMode): Promise<void> {
    const startTime = performance.now();
    const securityMode = mode ?? this.defaultSecurityMode;

    // 1. Mandatory Proton-Level Signing (skipped in "none" mode)
    let signedNode = node;
    if (securityMode !== "none") {
      signedNode = await this.signNode(node);
    }

    // 2. SECURITY CANARIES (Tripwires)
    if (securityMode !== "none") {
      // Canary A: Immediate Verification (Tampering Detect)
      const isVerified = await this.verifyNode(signedNode);
      if (!isVerified) {
        this.events.emit({
          event: "system:security:canary_tripped",
          payload: { type: "tampering", nodeId: signedNode["@id"] },
        });
        if (securityMode === "strict") {
          throw new Error(
            `[tractor] Security Alert: Tampering detected on node ${signedNode["@id"]}`,
          );
        }
      }

      // Canary B: Clock Skew Detection (Future nodes)
      const nodeClock = node["refarm:clock"] as number | undefined;
      const nodeTime =
        nodeClock ||
        (node["timestamp"]
          ? new Date(node["timestamp"] as string).getTime()
          : Date.now());

      if (typeof nodeTime === "number" && nodeTime > Date.now() + 10000) {
        // 10s grace
        this.events.emit({
          event: "system:security:canary_tripped",
          payload: { type: "clock_skew", nodeId: signedNode["@id"] },
        });
        if (securityMode === "strict") {
          throw new Error(
            `[tractor] Security Alert: Clock skew detected. Node is from the future.`,
          );
        }
      }
    }

    // 3. Delegate to storage adapter
    await this.storage.storeNode(
      signedNode["@id"] as string,
      signedNode["@type"],
      JSON.stringify(signedNode["@context"]),
      JSON.stringify(signedNode),
      (signedNode["refarm:sourcePlugin"] as string | undefined) ?? null,
    );

    this.events.emit({
      event: "storage:io",
      pluginId: node["refarm:sourcePlugin"] as string | undefined,
      durationMs: performance.now() - startTime,
      payload: { type: node["@type"], action: "store" },
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
    const nodes = rows.map(
      (r: { payload: string }) => JSON.parse(r.payload) as T,
    );
    this.events.emit({
      event: "storage:io",
      durationMs: performance.now() - startTime,
      payload: { type, action: "query", count: nodes.length },
    });
    return nodes;
  }

  /**
   * Internal helper to sign a node using the best available identity.
   * Throws if no identity is active (Visitor Mode).
   *
   * If the node already has a signature, it moves it to the 'refarm:signatures' array
   * and appends the new one.
   */
  async signNode(node: SovereignNode): Promise<SovereignNode> {
    const pubKey = this._ephemeralKeypair
      ? this.uint8ToHex(this._ephemeralKeypair.publicKey)
      : this.identity.publicKey;

    if (!pubKey) {
      throw new Error(
        "[tractor] Action blocked: You must be in Guest or Permanent mode to sign and store data.",
      );
    }

    // Deterministic Signing: Always sign the "Pure" node (excluding signatures)
    const {
      "refarm:signature": _s,
      "refarm:signatures": _ss,
      ...pureNode
    } = node;
    const nodeData = JSON.stringify(pureNode);
    const dataEncoded = new TextEncoder().encode(nodeData);

    let signature: SovereignSignature;

    // 1. Generate the signature
    if (this._ephemeralKeypair) {
      const sigData = await ed.signAsync(
        dataEncoded,
        this._ephemeralKeypair.secretKey,
      );
      signature = {
        pubkey: pubKey,
        sig: this.uint8ToHex(sigData),
        alg: "ed25519",
      };
    } else if (this.identity.sign) {
      const result = await this.identity.sign(nodeData);
      signature = {
        pubkey: pubKey,
        sig: result.signature,
        alg: result.algorithm,
      };
    } else {
      signature = {
        pubkey: pubKey,
        alg: "external",
        sig: "delegated",
      };
    }

    // 2. Attach to the node (Multi-signature support)
    const newNode = { ...node };

    if (newNode["refarm:signature"]) {
      // Transition to/update array if this is the second+ signature
      const existingSigs = newNode["refarm:signatures"] || [
        newNode["refarm:signature"] as SovereignSignature,
      ];
      newNode["refarm:signatures"] = [...existingSigs, signature];
      // Keep refarm:signature as the LATEST for convenience
      newNode["refarm:signature"] = signature;
    } else {
      newNode["refarm:signature"] = signature;
    }

    return newNode;
  }

  async shutdown(): Promise<void> {
    this.plugins.terminateAll();
    await this.storage.close();
    this.logInfo("[tractor] Shutdown ✓");
  }
}

export default Tractor;
