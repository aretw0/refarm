/**
 * @refarm.dev/tractor
 *
 * Refarm Tractor — the heavy machinery that cultivates your personal "Solo Fértil"
 * by orchestrating plugins and adapters under a sovereign micro-kernel.
 */

import * as ed from "@noble/ed25519";
import { IdentityAdapter } from "@refarm.dev/identity-contract-v1";
import { PluginManifest } from "@refarm.dev/plugin-manifest";
import { SovereignRegistry } from "@refarm.dev/registry";
import { StorageAdapter } from "@refarm.dev/storage-contract-v1";
import { SyncAdapter } from "@refarm.dev/sync-contract-v1";
import { CommandHost } from "./lib/command-host";
import {
  SovereignNode,
  SovereignSignature
} from "./lib/graph-normalizer";
import {
  PluginHost, PluginState,
  PluginTrustGrant
} from "./lib/plugin-host";
import { EventEmitter, TelemetryEvent, TelemetryHost, TelemetryListener } from "./lib/telemetry";
import {
  SecurityMode,
  TRACTOR_LOG_PRIORITY,
  TractorConfig,
  TractorLogLevel,
  isTractorLogLevel
} from "./lib/types";

export * from "./lib/graph-normalizer";
export * from "./lib/identity-recovery-host";
export * from "./lib/l8n-host";
export * from "./lib/plugin-host";
export * from "./lib/secret-host";
export * from "./lib/telemetry";
export * from "./lib/types";

function resolveDefaultLogLevel(configLevel?: TractorLogLevel): TractorLogLevel {
  if (configLevel) return configLevel;

  const env = (globalThis as any)?.process?.env as Record<string, string | undefined> | undefined;
  const envLevel = env?.REFARM_LOG_LEVEL;
  if (isTractorLogLevel(envLevel)) return envLevel;

  if (env?.VITEST === "true" || env?.NODE_ENV === "test") {
    return "silent";
  }

  return "info";
}

export class Tractor {
  static readonly VERSION = (import.meta as any).env?.VITE_REFARM_VERSION || "0.1.0-solo-fertil";
  readonly storage: StorageAdapter;
  readonly namespace: string;
  identity: IdentityAdapter;
  readonly sync?: SyncAdapter;
  readonly registry: any; // Using any for registry to avoid circular dependency or deep import issues in this sweep
  readonly plugins: PluginHost;
  readonly envMetadata: Record<string, string>;
  readonly commands: CommandHost;
  readonly defaultSecurityMode: SecurityMode;
  readonly logLevel: TractorLogLevel;
  readonly telemetry: TelemetryHost;

  private _ephemeralKeypair?: { publicKey: Uint8Array; secretKey: Uint8Array };
  private readonly events: EventEmitter = new EventEmitter();

  private constructor(
    storage: StorageAdapter,
    identity: IdentityAdapter,
    registry: SovereignRegistry,
    config: TractorConfig,
  ) {
    this.storage = storage;
    this.namespace = config.namespace;
    this.identity = identity;
    this.sync = config.sync;
    this.registry = registry;

    this.envMetadata = config.envMetadata || {};
    this.defaultSecurityMode = config.securityMode || "strict";
    this.logLevel = resolveDefaultLogLevel(config.logLevel);

    this.plugins = new PluginHost(
      (data) => this.events.emit(data),
      this.registry,
      {
        info: (...args: unknown[]) => this.logInfo(...args),
        warn: (...args: unknown[]) => this.logWarn(...args),
        debug: (...args: unknown[]) => this.logDebug(...args),
        error: (...args: unknown[]) => this.logError(...args),
      },
    );

    this.telemetry = new TelemetryHost({ capacity: 1000 });
    this.commands = new CommandHost((event: string, payload: any) =>
      this.events.emit({ event, payload }),
    );

    this.telemetry.register(this.events, this.commands);
    this.events.on((data) => this.plugins.dispatch(data));
    this.registerCoreCommands();

    if (config.forceGuestMode) {
      this.initializeEphemeralIdentity();
    } else {
      this.logInfo(`[tractor] Tractor ${Tractor.VERSION} Booted in Visitor Mode.`);
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
      handler: (args: { pluginId: string; wasmHash: string; leaseMs?: number }) => {
        if (!args?.pluginId || !args?.wasmHash) throw new Error("pluginId and wasmHash are required");
        return this.trustPlugin(args.pluginId, args.wasmHash, args.leaseMs);
      },
    });

    this.commands.register({
      id: "system:security:trust-plugin-once",
      title: "Trust Plugin Manifest (Once)",
      category: "Security",
      description: "Temporarily trust a plugin manifest for fast execution.",
      handler: (args: { manifest: PluginManifest; wasmHash: string; acknowledgeRisk: boolean }) => {
        if (!args?.acknowledgeRisk) throw new Error("Risk acknowledgment is required");
        const grant = this.trustPluginManifestOnce(args.manifest, args.wasmHash);
        return {
          warning: "✨ Trusted-fast enabled for this session.",
          grant,
        };
      },
    });

    this.commands.register({
        id: "system:security:revoke-plugin-trust",
        title: "Revoke Plugin Trust",
        category: "Security",
        description: "Revoke trusted-fast execution for a plugin fingerprint or all plugin grants.",
        handler: (args: { pluginId: string; wasmHash?: string }) => {
          if (!args?.pluginId) throw new Error("pluginId is required");
          this.revokePluginTrust(args.pluginId, args.wasmHash);
          return { ok: true };
        },
      });
  }

  private shouldLog(level: Exclude<TractorLogLevel, "silent">): boolean {
    if (this.logLevel === "silent") return false;
    const priority = TRACTOR_LOG_PRIORITY[level];
    const threshold = TRACTOR_LOG_PRIORITY[this.logLevel];
    return priority <= threshold;
  }

  private logInfo(...args: unknown[]): void { if (this.shouldLog("info")) console.info(...args); }
  private logWarn(...args: unknown[]): void { if (this.shouldLog("warn")) console.warn(...args); }
  private logDebug(...args: unknown[]): void { if (this.shouldLog("debug")) console.debug(...args); }
  private logError(...args: unknown[]): void { if (this.shouldLog("error")) console.error(...args); }

  async enableGuestMode(): Promise<string> {
    if (this._ephemeralKeypair) return this.uint8ToHex(this._ephemeralKeypair.publicKey);
    await this.initializeEphemeralIdentity();
    return this.uint8ToHex(this._ephemeralKeypair!.publicKey);
  }

  private async initializeEphemeralIdentity() {
    const privKey = ed.utils.randomSecretKey();
    const pubKey = await ed.getPublicKeyAsync(privKey);
    this._ephemeralKeypair = { publicKey: pubKey, secretKey: privKey };
    this.logInfo(`[tractor] Ephemeral Identity initialized: ${this.uint8ToHex(pubKey)}`);
    this.events.emit({
      event: "identity:ephemeral_ready",
      payload: { publicKey: this.uint8ToHex(pubKey) },
    });
  }

  private uint8ToHex(arr: Uint8Array): string {
    return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  private hexToUint8(hex: string): Uint8Array {
    const matches = hex.match(/.{1,2}/g);
    if (!matches) return new Uint8Array();
    return new Uint8Array(matches.map((byte) => parseInt(byte, 16)));
  }

  async verifyNode(node: SovereignNode): Promise<boolean> {
    const signature = node["refarm:signature"];
    if (!signature) return false;
    if (signature.alg === "external" && signature.sig === "delegated") return true;
    if (signature.alg !== "ed25519") return false;
    try {
      const { "refarm:signature": _s, "refarm:signatures": _ss, ...unsignedNode } = node;
      const data = new TextEncoder().encode(JSON.stringify(unsignedNode));
      const sig = this.hexToUint8(signature.sig);
      const pub = this.hexToUint8(signature.pubkey);
      return await ed.verifyAsync(sig, data, pub);
    } catch { return false; }
  }

  static async boot(config: TractorConfig): Promise<Tractor> {
    if (!config.storage) throw new Error("[tractor] A Storage Adapter is required to boot.");
    if (!config.identity) throw new Error("[tractor] An Identity Adapter is required to boot.");
    if ((config.storage as any).open) {
      config.storage = await (config.storage as any).open(config.namespace);
    }
    await config.storage.ensureSchema();
    if (config.sync) await config.sync.start();
    const registry = new SovereignRegistry();
    const tractor = new Tractor(config.storage, config.identity, registry, config);
    return tractor;
  }

  async spawnChild(namespace: string, configOverrides: Partial<TractorConfig> = {}): Promise<Tractor> {
    const childConfig: TractorConfig = {
      ...configOverrides,
      namespace,
      storage: configOverrides.storage || this.storage, 
      identity: configOverrides.identity || this.identity,
      logLevel: configOverrides.logLevel || this.logLevel,
      securityMode: configOverrides.securityMode || this.defaultSecurityMode,
    };
    return await Tractor.boot(childConfig);
  }

  observe(listener: TelemetryListener) { return this.events.on(listener); }
  trustPlugin(pluginId: string, wasmHash: string, leaseMs?: number): PluginTrustGrant {
    return this.plugins.grantTrust(pluginId, wasmHash, leaseMs);
  }
  trustPluginManifestOnce(manifest: PluginManifest, wasmHash: string): PluginTrustGrant {
    return this.plugins.trustManifestOnce(manifest, wasmHash);
  }
  revokePluginTrust(pluginId: string, wasmHash?: string): void {
    this.plugins.revokeTrust(pluginId, wasmHash);
  }
  setPluginState(pluginId: string, state: PluginState) {
    this.plugins.setState(pluginId, state);
  }
  emitTelemetry(data: TelemetryEvent) { this.events.emit(data); }

  async connectIdentity(adapter: IdentityAdapter): Promise<void> {
    const previousGuestKey = this._ephemeralKeypair;
    const permanentPubKey = adapter.publicKey;
    if (previousGuestKey && permanentPubKey) {
      const conversionNode: SovereignNode = {
        "@context": "https://refarm.dev/schemas/v1",
        "@type": "IdentityConversion",
        "@id": `urn:refarm:identity:conversion:${this.uint8ToHex(previousGuestKey.publicKey)}`,
        guestPubkey: this.uint8ToHex(previousGuestKey.publicKey),
        permanentPubkey: permanentPubKey,
        timestamp: new Date().toISOString(),
      };
      const guestSignedNode = await this.signNodeWithKeypair(conversionNode, previousGuestKey);
      this.identity = adapter;
      this._ephemeralKeypair = undefined;
      const doubleSignedNode = await this.signNode(guestSignedNode);
      await this.storage.storeNode(
        doubleSignedNode["@id"] as string,
        doubleSignedNode["@type"] as string,
        doubleSignedNode["@context"] as string,
        JSON.stringify(doubleSignedNode),
        "system:identity",
      );
    } else {
      this.identity = adapter;
      this._ephemeralKeypair = undefined;
    }
    this.events.emit({ event: "identity:connected", payload: { publicKey: adapter.publicKey } });
  }

  private async signNodeWithKeypair(node: SovereignNode, keypair: { publicKey: Uint8Array; secretKey: Uint8Array }): Promise<SovereignNode> {
    const data = new TextEncoder().encode(JSON.stringify(node));
    const signature = await ed.signAsync(data, keypair.secretKey);
    return {
      ...node,
      "refarm:signature": {
        pubkey: this.uint8ToHex(keypair.publicKey),
        sig: this.uint8ToHex(signature),
        alg: "ed25519",
      },
    };
  }

  async switchTier(tier: string): Promise<void> {
    this.events.emit({ event: "system:switch-tier", payload: { tier } });
  }

  async getHelpNodes(): Promise<SovereignNode[]> {
    const pluginHelp = await this.plugins.getHelpNodes();
    return [this.getSeedNode(), ...pluginHelp];
  }

  getSeedNode(): SovereignNode {
    return {
      "@context": "https://schema.org/",
      "@type": "HelpPage",
      "@id": "urn:refarm:core:seed",
      name: "Sovereign Engine",
      text: "The engine is active.",
      "refarm:sourcePlugin": "core",
      "refarm:priority": 0,
      "refarm:renderType": "landing",
    };
  }

  async storeNode(node: SovereignNode, mode?: SecurityMode): Promise<void> {
    const startTime = performance.now();
    const securityMode = mode ?? this.defaultSecurityMode;
    let signedNode = node;
    if (securityMode !== "none") {
      const timestamp = (node as any).timestamp;
      if (timestamp) {
        const CLOCK_SKEW_GRACE_MS = 10_000;
        if (new Date(timestamp).getTime() > Date.now() + CLOCK_SKEW_GRACE_MS) {
          this.events.emit({
            event: "system:security:canary_tripped",
            payload: { type: "clock_skew", nodeId: node["@id"], timestamp },
          });
          throw new Error(`[tractor] Security Alert: Clock skew detected on node ${node["@id"]}`);
        }
      }
      signedNode = await this.signNode(node);
      const isVerified = await this.verifyNode(signedNode);
      if (!isVerified) {
        this.events.emit({
          event: "system:security:canary_tripped",
          payload: { type: "tampering", nodeId: signedNode["@id"] },
        });
        if (securityMode === "strict") {
          throw new Error(`[tractor] Security Alert: Tampering detected on node ${signedNode["@id"]}`);
        }
      }
    }
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

  async queryNodes<T extends SovereignNode = SovereignNode>(type: string): Promise<T[]> {
    const rows = await this.storage.queryNodes(type);
    this.events.emit({ event: "storage:io", payload: { type, action: "query" } });
    return rows.map((r: { payload: string }) => JSON.parse(r.payload) as T);
  }

  async signNode(node: SovereignNode): Promise<SovereignNode> {
    const pubKey = this._ephemeralKeypair ? this.uint8ToHex(this._ephemeralKeypair.publicKey) : this.identity.publicKey;
    if (!pubKey) throw new Error("[tractor] Action blocked: You must be in Guest or Permanent mode to sign and store data.");
    const { "refarm:signature": _s, "refarm:signatures": _ss, ...pureNode } = node;
    const nodeData = JSON.stringify(pureNode);
    const dataEncoded = new TextEncoder().encode(nodeData);
    let signature: SovereignSignature;
    if (this._ephemeralKeypair) {
      const sigData = await ed.signAsync(dataEncoded, this._ephemeralKeypair.secretKey);
      signature = { pubkey: pubKey, sig: this.uint8ToHex(sigData), alg: "ed25519" };
    } else if (this.identity.sign) {
      const result = await this.identity.sign(nodeData);
      signature = { pubkey: pubKey, sig: result.signature, alg: result.algorithm };
    } else {
      signature = { pubkey: pubKey, alg: "external", sig: "delegated" };
    }
    const newNode = { ...node };
    if (newNode["refarm:signature"]) {
      const existingSigs = newNode["refarm:signatures"] || [newNode["refarm:signature"] as SovereignSignature];
      newNode["refarm:signatures"] = [...existingSigs, signature];
      newNode["refarm:signature"] = signature;
    } else {
      newNode["refarm:signature"] = signature;
    }
    return newNode;
  }

  async shutdown(): Promise<void> {
    this.logInfo("[tractor] Shutting down heavy machinery...");
    this.plugins.terminateAll();
    await this.storage.close();
    this.logInfo("[tractor] Tractor Shutdown complete.");
  }
}

export default Tractor;
