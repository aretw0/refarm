import * as jco from "@bytecodealliance/jco";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PluginManifest } from "@refarm.dev/plugin-manifest";
import { SovereignRegistry } from "@refarm.dev/registry";
import { TelemetryEvent } from "./telemetry";
import { TractorLogger, TractorLogLevel } from "./types";
import { SovereignNode } from "./graph-normalizer";

export type PluginState = "idle" | "running" | "hot" | "throttled" | "error";

/**
 * A handle to a running WASM plugin instance.
 */
export interface PluginInstance {
  id: string;
  name: string;
  manifest: PluginManifest;
  call(fn: string, args?: unknown): Promise<unknown>;
  terminate(): void;
  emitTelemetry(event: string, payload?: any): void;
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
 */
export class PluginHost {
  private _instances: Map<string, PluginInstance> = new Map();
  private readonly trustGrants: Map<string, PluginTrustGrant> = new Map();

  constructor(
    private emit: (data: TelemetryEvent) => void,
    private registry: SovereignRegistry,
    private logger: TractorLogger = console,
  ) {}

  private getTrustKey(pluginId: string, wasmHash: string): string {
    return `${pluginId}::${wasmHash}`;
  }

  hasValidTrustGrant(pluginId: string, wasmHash?: string): boolean {
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

  private getWasiImports(manifest: PluginManifest, profile: ExecutionProfile) {
    const allowedOrigins = manifest.capabilities.allowedOrigins ?? [];
    const isTrustedFast = profile === "trusted-fast";

    const isAllowedRequest = (request: unknown): boolean => {
      if (isTrustedFast) return true;
      if (allowedOrigins.length === 0) return false;

      const url = typeof request === "string" ? request : (request as { url?: string })?.url;
      if (!url) return false;

      return allowedOrigins.some((origin: string) => url.startsWith(origin));
    };

    const wasiLogging = {
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
    };

    const wasiEnvironment = {
      getEnvironment: () => [],
      getArguments: () => [],
      initialDirectory: () => undefined,
    };

    const wasiStreams = {
      read: async () => [new Uint8Array(), true],
      write: async () => 0n,
      blockingRead: async () => [new Uint8Array(), true],
      blockingWrite: async () => 0n,
      subscribe: () => 0n,
      drop: () => {},
      InputStream: class InputStream {},
      OutputStream: class OutputStream {},
    };

    const wasiStubs = {
      "wasi:cli/exit": { exit: () => {} },
      "wasi:cli/stdin": { getStdin: () => 0 },
      "wasi:cli/stdout": { getStdout: () => 1 },
      "wasi:cli/stderr": { getStderr: () => 2 },
      "wasi:clocks/wall-clock": {
        now: () => ({ seconds: BigInt(Math.floor(Date.now() / 1000)), nanoseconds: 0 }),
        resolution: () => ({ seconds: 1n, nanoseconds: 0 }),
      },
      "wasi:filesystem/types": {
        filesystemErrorCode: () => {},
        descriptor: class Descriptor {},
        Descriptor: class Descriptor {},
      },
      "wasi:filesystem/preopens": { getDirectories: () => [] },
      "wasi:random/random": {
        getRandomBytes: (len: bigint) => new Uint8Array(Number(len)),
        getRandomU64: () => 0n,
      },
      "wasi:io/error": { 
        error: class Error {},
        Error: class Error {},
       },
      "wasi:io/streams": wasiStreams,
    };

    const imports: any = {
      "wasi:logging/logging": wasiLogging,
      "wasi:logging/logging@0.1.0-draft": wasiLogging,
      "wasi:cli/environment": wasiEnvironment,
      "wasi:cli/environment@0.2.0": wasiEnvironment,
      "wasi:cli/environment@0.2.3": wasiEnvironment,
      "wasi:http/outgoing-handler": {
        handle: async (request: any) => {
          if (!isAllowedRequest(request)) {
            const url = typeof request === "string" ? request : request?.url;
            console.warn(`[tractor] Blocked unauthorized fetch to ${url || "<unknown>"} by ${manifest.id}`);
            throw new Error("HTTP request not permitted by capabilities");
          }
          return fetch(request);
        },
      },
      "refarm:plugin/tractor-bridge": {
        "store-node": async (nodeJson: string) => "node-id-stub",
        "request-permission": async (cap: string, reason: string) => true,
      },
    };

    const versions = ["", "@0.2.0", "@0.2.3"];
    for (const [key, val] of Object.entries(wasiStubs)) {
      for (const v of versions) {
        imports[`${key}${v}`] = val;
      }
    }

    return imports;
  }

  async load(
    manifest: PluginManifest,
    wasmHash?: string,
  ): Promise<PluginInstance> {
    const pluginId = manifest.id;
    const wasmUrl = manifest.entry;
    const startTime = performance.now();

    const profile = this.resolveExecutionProfile(manifest, wasmHash);
    const trust = (manifest as any).trust;

    if (trust?.profile === "trusted-fast" && !wasmHash) {
      throw new Error(`[tractor] Trusted-fast requires wasmHash for ${pluginId}.`);
    }

    if (trust?.profile === "trusted-fast" && wasmHash) {
      const grants = this.getGrantsForPlugin(pluginId);
      const hasGrantForCurrentHash = grants.some((grant) => grant.wasmHash === wasmHash);
      if (grants.length > 0 && !hasGrantForCurrentHash) {
        this.revokeTrust(pluginId);
        throw new Error(`[tractor] Trusted-fast revoked for ${pluginId}: wasm hash changed.`);
      }
    }

    if (trust?.profile === "trusted-fast" && profile !== "trusted-fast") {
      throw new Error(`[tractor] Trusted-fast denied for ${pluginId}. Grant trust before loading.`);
    }

    const registryEntry = this.registry.getPlugin(pluginId);
    if (!registryEntry || (registryEntry.status !== "validated" && registryEntry.status !== "active")) {
        this.logger.warn(`[tractor] Loading plugin ${pluginId} with status: ${registryEntry?.status || "unregistered"}`);
    }

    this.logger.debug(`[tractor] Fetching plugin WASM: ${wasmUrl}`);
    let wasmBuffer: ArrayBuffer;

    if (wasmUrl.startsWith("file://")) {
        const filePath = wasmUrl.replace("file://", "");
        const buffer = await fs.readFile(filePath);
        wasmBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    } else {
        const response = await fetch(wasmUrl);
        if (!response.ok) throw new Error(`[tractor] Failed to fetch plugin: ${response.statusText}`);
        wasmBuffer = await response.arrayBuffer();
    }

    const imports = this.getWasiImports(manifest, profile);
    let componentInstance: any = null;
    try {
        const opts = { name: pluginId.replace(/[^a-z0-9]/gi, '_') };
        const { files } = await jco.transpile(new Uint8Array(wasmBuffer), opts as any);
        
        const distDir = path.resolve(__dirname, "../.jco-dist", pluginId);
        await fs.mkdir(distDir, { recursive: true });
        
        const jcoName = pluginId.replace(/[^a-z0-9]/gi, '_');
        let entryPoint = "";

        for (const [filename, content] of Object.entries(files)) {
            const filePath = path.join(distDir, filename);
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, content as any);
            if (filename === `${jcoName}.js`) entryPoint = filePath;
        }

        if (!entryPoint) {
            const items = await fs.readdir(distDir);
            const rootJs = items.find(f => f.endsWith(".js"));
            if (rootJs) entryPoint = path.join(distDir, rootJs);
        }

        if (!entryPoint) throw new Error(`[tractor] No JS entry point found found for ${pluginId}`);

        const relativePath = "./" + path.relative(__dirname, entryPoint).replace(/\\/g, "/");
        const module = await import(relativePath);
        
        if (module.instantiate) {
            componentInstance = await module.instantiate(imports, (name: string) => {
                const wasmFile = Object.entries(files).find(([f]) => f.includes(name) && f.endsWith(".wasm"));
                return wasmFile ? wasmFile[1] : null;
            });
        } else {
            componentInstance = module;
        }
    } catch (e: any) {
        this.logger.warn(`[tractor] JCO instantiation failed for ${pluginId}: ${e.message}`);
    }

    const instance: PluginInstance = {
      id: pluginId,
      name: manifest.name,
      manifest,
      call: async (fn, args) => {
        const callStart = performance.now();
        let result = null;
        if (componentInstance) {
            if (componentInstance.integration && typeof componentInstance.integration[fn] === "function") {
                result = await componentInstance.integration[fn](args);
            } else if (typeof componentInstance[fn] === "function") {
                result = await componentInstance[fn](args);
            }
        }

        this.emit({
          event: "api:call",
          pluginId,
          durationMs: performance.now() - callStart,
          payload: { fn, args, result },
        });
        return result;
      },
      terminate: () => {
        this._instances.delete(pluginId);
        this.registry.deactivatePlugin(pluginId).catch(() => {});
        this.emit({ event: "plugin:terminate", pluginId });
      },
      emitTelemetry: (event, payload) => this.emit({ event, pluginId, payload }),
      state: "running",
    };

    this._instances.set(pluginId, instance);

    try {
      await instance.call("setup");
      if (registryEntry && registryEntry.status === "validated") {
          await this.registry.activatePlugin(pluginId);
      }
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

  registerInternal(instance: PluginInstance) {
    if (!instance.state) instance.state = "running";
    this._instances.set(instance.id, instance);
    this.emit({ event: "plugin:load", pluginId: instance.id });
  }

  setState(pluginId: string, state: PluginState) {
    const instance = this._instances.get(pluginId);
    if (instance && instance.state !== state) {
      instance.state = state;
      this.emit({ event: "system:plugin_state_changed", pluginId, payload: { state } });
    }
  }

  dispatch(event: TelemetryEvent) {
    for (const instance of this._instances.values()) {
      if (event.event.startsWith("system:")) {
        instance.call("on-event", [event.event, JSON.stringify(event.payload)]);
      }
    }
  }

  async getHelpNodes(): Promise<SovereignNode[]> {
    const allHelp: SovereignNode[] = [];
    for (const plugin of this._instances.values()) {
      try {
        const nodes = (await plugin.call("get-help-nodes")) as any[];
        if (nodes) allHelp.push(...nodes.map((n) => JSON.parse(n)));
      } catch {}
    }
    return allHelp;
  }

  findByApi(apiName: string): PluginInstance | undefined {
    for (const instance of this._instances.values()) {
      if (instance.manifest.capabilities.providesApi?.includes(apiName)) return instance;
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
