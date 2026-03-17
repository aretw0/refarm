/**
 * @refarm.dev/tractor — browser-safe entrypoint
 *
 * This module re-exports all browser-compatible APIs from Tractor.
 * PluginHost is replaced with a stub: it satisfies TypeScript consumers
 * but throws a descriptive error at runtime when plugin loading is attempted.
 *
 * Plugin loading in the browser requires a pre-installed WASM cache (OPFS).
 * See ADR-044: specs/ADRs/ADR-044-wasm-plugin-loading-browser-strategy.md
 */

export * from "./lib/graph-normalizer";
export * from "./lib/identity-recovery-host";
export * from "./lib/l8n-host";
export * from "./lib/secret-host";
export * from "./lib/telemetry";
export * from "./lib/types";

// Re-export types from plugin-host's dependencies directly (no Node deps)
export type { PluginInstance, PluginState } from "./lib/instance-handle";
export type { PluginTrustGrant, ExecutionProfile } from "./lib/trust-manager";

import type { PluginManifest } from "@refarm.dev/plugin-manifest";
import type { SovereignNode } from "./lib/graph-normalizer";
import type { TelemetryEvent } from "./lib/telemetry";
import type { PluginInstance, PluginState } from "./lib/instance-handle";
import type { PluginTrustGrant, ExecutionProfile } from "./lib/trust-manager";
import type { TractorLogger } from "./lib/types";

const BROWSER_ERROR =
  "[tractor] PluginHost requires the Node.js runtime or a pre-installed WASM cache. " +
  "Use installPlugin() to cache the transpiled module to OPFS first. See ADR-044.";

/**
 * Browser stub for PluginHost.
 *
 * The constructor does not throw — Tractor can boot in the browser.
 * Methods that require Node.js or a WASM cache throw at call time.
 * Read-only queries return empty results instead of throwing.
 */
export class PluginHost {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_emit: (data: TelemetryEvent) => void, _registry: any, _logger?: TractorLogger) {
    // no-op: allow Tractor to boot in browser without plugin support
  }

  hasValidTrustGrant(_pluginId: string, _wasmHash?: string): boolean {
    return false;
  }

  grantTrust(_pluginId: string, _wasmHash: string, _leaseMs?: number): PluginTrustGrant {
    throw new Error(BROWSER_ERROR);
  }

  trustManifestOnce(_manifest: PluginManifest, _wasmHash: string): PluginTrustGrant {
    throw new Error(BROWSER_ERROR);
  }

  revokeTrust(_pluginId: string, _wasmHash?: string): void {
    // no-op in browser
  }

  async load(_manifest: PluginManifest, _wasmHash?: string): Promise<PluginInstance> {
    throw new Error(BROWSER_ERROR);
  }

  getWasiImports(_manifest: PluginManifest, _profile: ExecutionProfile): Record<string, unknown> {
    return {};
  }

  registerInternal(_instance: PluginInstance): void {
    // no-op in browser
  }

  setState(_pluginId: string, _state: PluginState): void {
    // no-op in browser
  }

  dispatch(_event: TelemetryEvent): void {
    // no-op in browser
  }

  async getHelpNodes(): Promise<SovereignNode[]> {
    return [];
  }

  findByApi(_apiName: string): PluginInstance | undefined {
    return undefined;
  }

  get(_pluginId: string): PluginInstance | undefined {
    return undefined;
  }

  getAllPlugins(): PluginInstance[] {
    return [];
  }

  terminateAll(): void {
    // no-op in browser
  }
}

export { installPlugin } from "./lib/install-plugin";
export type { InstallPluginResult } from "./lib/install-plugin";
export { getCachedPlugin, cachePlugin, evictPlugin } from "./lib/opfs-plugin-cache";
