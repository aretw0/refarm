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
    let result = null;
    if (this.componentInstance) {
      if (
        this.componentInstance.integration &&
        typeof this.componentInstance.integration[fn] === "function"
      ) {
        result = await this.componentInstance.integration[fn](args);
      } else if (typeof this.componentInstance[fn] === "function") {
        result = await this.componentInstance[fn](args);
      }
    }

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
