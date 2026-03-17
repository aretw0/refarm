import * as jco from "@bytecodealliance/jco";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PluginManifest } from "@refarm.dev/plugin-manifest";
import { SovereignRegistry } from "@refarm.dev/registry";
import { TelemetryEvent } from "./telemetry";
import { TractorLogger, SecurityMode } from "./types";
import { SovereignNode } from "./graph-normalizer";
import { TrustManager, ExecutionProfile } from "./trust-manager";
import type { PluginTrustGrant } from "./trust-manager";
import { WasiImports } from "./wasi-imports";
import { PluginInstanceHandle } from "./instance-handle";
import type { PluginInstance, PluginState } from "./instance-handle";

export type { PluginInstance, PluginState, PluginTrustGrant };

/**
 * Sandboxed plugin host.
 * Orchestrates trust, lifecycle, and WASI integration.
 */
export class PluginHost {
  private _instances: Map<string, PluginInstance> = new Map();
  private trustManager: TrustManager;

  constructor(
    private emit: (data: TelemetryEvent) => void,
    private registry: SovereignRegistry,
    private logger: TractorLogger = console,
    private securityMode: SecurityMode = "strict",
  ) {
    this.trustManager = new TrustManager(emit);
  }

  hasValidTrustGrant(pluginId: string, wasmHash?: string): boolean {
    return this.trustManager.hasValidTrustGrant(pluginId, wasmHash);
  }

  grantTrust(pluginId: string, wasmHash: string, leaseMs?: number): PluginTrustGrant {
    return this.trustManager.grantTrust(pluginId, wasmHash, leaseMs);
  }

  trustManifestOnce(manifest: PluginManifest, wasmHash: string): PluginTrustGrant {
    return this.trustManager.trustManifestOnce(manifest, wasmHash);
  }

  revokeTrust(pluginId: string, wasmHash?: string): void {
    this.trustManager.revokeTrust(pluginId, wasmHash);
  }

  async load(
    manifest: PluginManifest,
    wasmHash?: string,
  ): Promise<PluginInstance> {
    const pluginId = manifest.id;
    const wasmUrl = manifest.entry;
    const startTime = performance.now();

    const profile = this.trustManager.resolveExecutionProfile(manifest, wasmHash);
    const trust = (manifest as any).trust;

    if (trust?.profile === "trusted-fast" && !wasmHash) {
      throw new Error(`[tractor] Trusted-fast requires wasmHash for ${pluginId}.`);
    }

    if (trust?.profile === "trusted-fast" && wasmHash) {
      const grants = this.trustManager.getGrantsForPlugin(pluginId);
      const hasGrantForCurrentHash = grants.some((grant) => grant.wasmHash === wasmHash);
      if (grants.length > 0 && !hasGrantForCurrentHash) {
        this.trustManager.revokeTrust(pluginId);
        throw new Error(`[tractor] Trusted-fast revoked for ${pluginId}: wasm hash changed.`);
      }
    }

    if (trust?.profile === "trusted-fast" && profile !== "trusted-fast") {
      throw new Error(`[tractor] Trusted-fast denied for ${pluginId}. Grant trust before loading.`);
    }

    const registryEntry = this.registry.getPlugin(pluginId);
    if (!registryEntry || (registryEntry.status !== "validated" && registryEntry.status !== "active")) {
        const msg = `[tractor] Plugin ${pluginId} is not validated (status: ${registryEntry?.status ?? "unregistered"})`;
        if (this.securityMode !== "permissive") {
            throw new Error(msg);
        }
        this.logger.warn(msg);
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

    const wasi = new WasiImports(pluginId, this.logger, this.emit);
    const imports = wasi.generate(manifest, profile);
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

    const instance = new PluginInstanceHandle(
      pluginId,
      manifest.name,
      manifest,
      componentInstance,
      this.emit,
      (id) => {
        this._instances.delete(id);
        this.registry.deactivatePlugin(id).catch(() => {});
      }
    );

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

  getWasiImports(manifest: PluginManifest, profile: ExecutionProfile): any {
    const wasi = new WasiImports(manifest.id, this.logger, this.emit);
    return wasi.generate(manifest, profile);
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
