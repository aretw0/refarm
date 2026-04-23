// Dynamic import — node:fs/promises is only needed for file:// URLs (Node.js path).
// Keeping it dynamic prevents the browser bundle from pulling in Node-only modules.
import {
  assertEntryRuntimeCompatibility,
  detectEntryFormat,
  type PluginManifest,
} from "@refarm.dev/plugin-manifest";
import { SovereignRegistry } from "@refarm.dev/registry";
import { TelemetryEvent } from "./telemetry";
import { TractorLogger, SecurityMode } from "./types";
import { SovereignNode } from "./graph-normalizer";
import { TrustManager, ExecutionProfile } from "./trust-manager";
import type { PluginTrustGrant } from "./trust-manager";
import { WasiImports } from "./wasi-imports";
import { PluginInstanceHandle } from "./instance-handle";
import type { PluginInstance, PluginState } from "./instance-handle";
import type { PluginRunner } from "./plugin-runner";
import { MainThreadRunner } from "./main-thread-runner";
import { WorkerRunner } from "./worker-runner";
import { getCachedPlugin } from "./opfs-plugin-cache";

export type { PluginInstance, PluginState, PluginTrustGrant };

/**
 * Sandboxed plugin host.
 * Orchestrates trust, lifecycle, and WASI integration.
 */
export class PluginHost {
  private _instances: Map<string, PluginInstance> = new Map();
  private trustManager: TrustManager;
  private _mainThreadRunner: MainThreadRunner;
  private _workerRunner: WorkerRunner;

  constructor(
    private emit: (data: TelemetryEvent) => void,
    private registry: SovereignRegistry,
    private logger: TractorLogger = console,
    private securityMode: SecurityMode = "strict",
    private distBase: string = __dirname + "/../.jco-dist",
    private storeNode?: (nodeJson: string) => Promise<void>,
  ) {
    this.trustManager = new TrustManager(emit);
    this._mainThreadRunner = new MainThreadRunner(this.distBase, this.logger);
    this._workerRunner = new WorkerRunner(this.storeNode);
  }

  /**
   * Resolves the appropriate PluginRunner for a manifest's execution context.
   * Respects `preferred` → `fallback` → main-thread cascade.
   */
  private resolveRunner(manifest: PluginManifest): PluginRunner {
    const ctx = manifest.executionContext;
    if (!ctx) return this._mainThreadRunner;

    const preferred = ctx.preferred;

    if (preferred === "worker" && this._workerRunner.supports(manifest)) {
      return this._workerRunner;
    }

    if (ctx.fallback === "main-thread" || !ctx.fallback) {
      return this._mainThreadRunner;
    }

    // Unrecognized fallback — default to main thread
    this.logger.warn(
      `[tractor] executionContext.fallback "${ctx.fallback}" not supported; using main-thread`,
    );
    return this._mainThreadRunner;
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

  private normalizeJavaScriptModule(moduleNamespace: any): any {
    if (!moduleNamespace) return moduleNamespace;

    const defaultExport = moduleNamespace.default;
    if (defaultExport && typeof defaultExport === "object") {
      return {
        ...defaultExport,
        ...moduleNamespace,
      };
    }

    return moduleNamespace;
  }

  private encodeBase64Utf8(source: string): string {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(source, "utf8").toString("base64");
    }

    const bytes = new TextEncoder().encode(source);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  private async loadJavaScriptModule(entryUrl: string): Promise<any> {
    try {
      const moduleNamespace = await import(/* @vite-ignore */ entryUrl);
      return this.normalizeJavaScriptModule(moduleNamespace);
    } catch {
      const response = await fetch(entryUrl);
      if (!response.ok) {
        throw new Error(
          `[tractor] Failed to fetch plugin JS module: ${response.statusText}`,
        );
      }

      const source = await response.text();
      const dataUrl = `data:text/javascript;base64,${this.encodeBase64Utf8(source)}`;
      const moduleNamespace = await import(/* @vite-ignore */ dataUrl);
      return this.normalizeJavaScriptModule(moduleNamespace);
    }
  }

  private async readWasmBuffer(
    pluginId: string,
    wasmUrl: string,
  ): Promise<ArrayBuffer> {
    if (wasmUrl.startsWith("file://")) {
      const filePath = wasmUrl.replace("file://", "");
      const { readFile } = await import("node:fs/promises");
      const buffer = await readFile(filePath);
      return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      );
    }

    if (detectEntryFormat(wasmUrl) === "wasm") {
      const cached = await getCachedPlugin(pluginId);
      if (cached) {
        this.logger.debug(`[tractor] Using cached plugin WASM: ${pluginId}`);
        return cached;
      }
    }

    const response = await fetch(wasmUrl);
    if (!response.ok)
      throw new Error(`[tractor] Failed to fetch plugin: ${response.statusText}`);
    return response.arrayBuffer();
  }

  async load(
    manifest: PluginManifest,
    wasmHash?: string,
  ): Promise<PluginInstance> {
    const pluginId = manifest.id;
    const wasmUrl = manifest.entry;
    const entryFormat = detectEntryFormat(wasmUrl);
    const startTime = performance.now();

    assertEntryRuntimeCompatibility(wasmUrl, "node");

    const profile = this.trustManager.resolveExecutionProfile(manifest, wasmHash);
    const trust = (manifest as any).trust;

    if (trust?.profile === "trusted-fast" && entryFormat !== "wasm") {
      throw new Error(
        `[tractor] Trusted-fast is only available for .wasm plugin entries (${pluginId}).`,
      );
    }

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

    if (entryFormat !== "wasm") {
      this.logger.debug(`[tractor] Loading JavaScript plugin module: ${wasmUrl}`);
      const moduleNamespace = await this.loadJavaScriptModule(wasmUrl);

      const instance = new PluginInstanceHandle(
        pluginId,
        manifest.name,
        manifest,
        moduleNamespace,
        this.emit,
        (id) => {
          this._instances.delete(id);
          this.registry.deactivatePlugin(id).catch(() => {});
        },
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
        payload: { profile, wasmHash, entryType: "js" },
      });

      return instance;
    }

    this.logger.debug(`[tractor] Loading plugin WASM: ${wasmUrl}`);
    const wasmBuffer = await this.readWasmBuffer(pluginId, wasmUrl);

    const wasi = new WasiImports(pluginId, this.logger, this.emit, this.storeNode);
    const imports = wasi.generate(manifest, profile);
    const runner = this.resolveRunner(manifest);

    const instance = await runner.instantiate(
      manifest,
      wasmBuffer,
      imports,
      this.emit,
      (id) => {
        this._instances.delete(id);
        this.registry.deactivatePlugin(id).catch(() => {});
      },
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
