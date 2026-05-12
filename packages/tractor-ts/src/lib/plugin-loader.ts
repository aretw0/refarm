import { transpile } from "@bytecodealliance/jco";
import type { PluginManifest } from "@refarm.dev/plugin-manifest";
import type { TelemetryEvent } from "../index.js";

/**
 * Interface for the Tractor host to provide to the plugin.
 * Mirrors the 'tractor-bridge' interface in refarm-sdk.wit.
 */
export interface TractorBridge {
  storeNode(node: string): Promise<{ tag: "ok"; val: string } | { tag: "err"; val: unknown }>;
  getNode(id: string): Promise<{ tag: "ok"; val: string } | { tag: "err"; val: unknown }>;
  queryNodes(type: string, limit: number): Promise<{ tag: "ok"; val: string[] } | { tag: "err"; val: unknown }>;
  fetch(req: Record<string, unknown>): Promise<{ tag: "ok"; val: unknown } | { tag: "err"; val: unknown }>;
  log(level: string, message: string): void;
  requestPermission(capability: string, reason: string): boolean;
  getIdentity(): Promise<{ tag: "ok"; val: unknown } | { tag: "err"; val: unknown }>;
  getPluginApi(apiName: string): Promise<{ tag: "ok"; val: string } | { tag: "err"; val: unknown }>;
  emitTelemetry(event: string, payload?: string): void;
}

/**
 * Handles the loading, transpilation, and instantiation of WASM plugins.
 */
export class PluginLoader {
  constructor(
    private bridge: TractorBridge,
    private emit: (data: TelemetryEvent) => void
  ) {}

  /**
   * Loads a WASM component and returns its exports (specifically the 'integration' interface).
   */
  async load(manifest: PluginManifest): Promise<unknown> {
    const wasmUrl = manifest.entry;
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`Failed to fetch WASM from ${wasmUrl}`);
    const buffer = await response.arrayBuffer();

    // Dynamically transpile the component into a JS module
    // Note: In a production environment, this should ideally be done by a worker
    // or cached in IndexedDB to avoid repeated transpilation.
    const transpiled = await transpile(new Uint8Array(buffer), {
      name: manifest.id,
      instantiation: true,
      map: {
        "refarm:plugin/tractor-bridge": "host:tractor-bridge"
      }
    });

    // Create a Blob and a URL for the generated JS
    const jsContent = transpiled.files["index.js"];
    const blob = new Blob([jsContent], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);

    try {
      // Import the generated module
      // We need to provide the 'host:tractor-bridge' import
      // JCO transpile with 'instantiation: true' expects imports to be provided
      const module = await import(url);
      
      // Instantiate the component with our bridge
      const instance = await module.instantiate(new Uint8Array(buffer), {
        "refarm:plugin/tractor-bridge": this.bridge
      });

      return instance.integration;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}
