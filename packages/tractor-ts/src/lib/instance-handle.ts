import { PluginManifest } from "@refarm.dev/plugin-manifest";
import { TelemetryEvent } from "./telemetry";

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

export class PluginInstanceHandle implements PluginInstance {
  state: PluginState = "running";

  private toCamelCase(name: string): string {
    return name.replace(/-([a-z])/g, (_full, chr: string) => chr.toUpperCase());
  }

  private integrationNamespaces(): any[] {
    if (!this.componentInstance || typeof this.componentInstance !== "object") {
      return [];
    }

    const namespaces: any[] = [];
    const integration = (this.componentInstance as any).integration;
    if (integration && typeof integration === "object") {
      namespaces.push(integration);
    }

    const namespaced = Object.entries(this.componentInstance)
      .filter(
        ([key, value]) =>
          key.startsWith("refarm:plugin/integration@") &&
          !!value &&
          typeof value === "object",
      )
      .map(([, value]) => value);

    namespaces.push(...namespaced);
    return namespaces;
  }

  private resolveCallable(fn: string): ((args?: unknown) => Promise<unknown> | unknown) | null {
    if (!this.componentInstance) return null;

    const candidates = fn === this.toCamelCase(fn) ? [fn] : [fn, this.toCamelCase(fn)];

    for (const ns of this.integrationNamespaces()) {
      for (const candidate of candidates) {
        const maybeFn = ns?.[candidate];
        if (typeof maybeFn === "function") {
          return maybeFn.bind(ns);
        }
      }
    }

    for (const candidate of candidates) {
      const maybeFn = this.componentInstance[candidate];
      if (typeof maybeFn === "function") {
        return maybeFn.bind(this.componentInstance);
      }
    }

    return null;
  }

  constructor(
    public id: string,
    public name: string,
    public manifest: PluginManifest,
    private componentInstance: any,
    private emit: (data: TelemetryEvent) => void,
    private onTerminate: (id: string) => void
  ) {}

  async call(fn: string, args?: unknown): Promise<unknown> {
    const callStart = performance.now();
    let result: unknown;

    if (!this.componentInstance) {
      const error = new Error(
        `Plugin \"${this.id}\" is not instantiated (component instance unavailable)`,
      );
      this.emit({
        event: "api:call",
        pluginId: this.id,
        durationMs: performance.now() - callStart,
        payload: { fn, args, error: error.message },
      });
      throw error;
    }

    const callable = this.resolveCallable(fn);
    if (!callable) {
      const available = [
        ...new Set([
          ...Object.keys(this.componentInstance || {}),
          ...this.integrationNamespaces().flatMap((ns) => Object.keys(ns || {})),
        ]),
      ]
        .filter((name) => typeof name === "string")
        .sort();
      const error = new Error(
        `Plugin \"${this.id}\" does not expose callable \"${fn}\" (available: ${available.join(", ") || "none"})`,
      );
      this.emit({
        event: "api:call",
        pluginId: this.id,
        durationMs: performance.now() - callStart,
        payload: { fn, args, error: error.message },
      });
      throw error;
    }

    result = await callable(args);

    this.emit({
      event: "api:call",
      pluginId: this.id,
      durationMs: performance.now() - callStart,
      payload: { fn, args, result },
    });
    return result;
  }

  terminate(): void {
    this.onTerminate(this.id);
    this.emit({ event: "plugin:terminate", pluginId: this.id });
  }

  emitTelemetry(event: string, payload?: any): void {
    this.emit({ event, pluginId: this.id, payload });
  }
}
