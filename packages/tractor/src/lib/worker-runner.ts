import { PluginManifest } from "@refarm.dev/plugin-manifest";
import { TelemetryEvent } from "./telemetry";
import { PluginInstanceHandle } from "./instance-handle";
import type { PluginInstance, PluginState } from "./instance-handle";
import type { PluginRunner } from "./plugin-runner";

/**
 * Plugin runner that instantiates WASM plugins inside a dedicated WebWorker.
 *
 * The plugin's worker bootstrap (e.g. plugin-tem/src/worker.ts) exposes a
 * message-based interface. WorkerRunner wraps this in a PluginInstance so
 * the PluginHost can communicate with the worker transparently.
 *
 * Protocol (postMessage):
 *   → { type: "call", id, fn, args }
 *   ← { type: "result", id, result }  |  { type: "error", id, message }
 *   → { type: "terminate" }
 *   ← { type: "telemetry", event, payload }
 *
 * Note: For richer async ergonomics in production use, consider adding Comlink
 * as a dependency in the plugin package (not in tractor). The message protocol
 * above is intentionally simple and Comlink-compatible.
 */
export class WorkerRunner implements PluginRunner {
  supports(_manifest: PluginManifest): boolean {
    return typeof Worker !== "undefined";
  }

  async instantiate(
    manifest: PluginManifest,
    _wasmBuffer: ArrayBuffer,
    _imports: Record<string, any>,
    emit: (data: TelemetryEvent) => void,
    onTerminate: (id: string) => void,
  ): Promise<PluginInstance> {
    const pluginId = manifest.id;
    const workerEntry = (manifest as any).workerEntry ?? manifest.entry;

    const worker = new Worker(workerEntry, { type: "module" });
    const pendingCalls = new Map<
      string,
      { resolve: (v: unknown) => void; reject: (e: Error) => void }
    >();
    let callSeq = 0;

    worker.addEventListener("message", (ev) => {
      const msg = ev.data as any;
      if (msg.type === "result" || msg.type === "error") {
        const pending = pendingCalls.get(msg.id);
        if (!pending) return;
        pendingCalls.delete(msg.id);
        if (msg.type === "result") {
          pending.resolve(msg.result);
        } else {
          pending.reject(new Error(msg.message));
        }
      } else if (msg.type === "telemetry") {
        emit({ event: msg.event, pluginId, payload: msg.payload });
      }
    });

    // Wrap Worker in a PluginInstanceHandle-compatible shim
    const callWorker = (fn: string, args?: unknown): Promise<unknown> => {
      const id = `${pluginId}:${++callSeq}`;
      return new Promise((resolve, reject) => {
        pendingCalls.set(id, { resolve, reject });
        worker.postMessage({ type: "call", id, fn, args });
      });
    };

    const workerInstance: PluginInstance = {
      id: pluginId,
      name: manifest.name,
      manifest,
      state: "running" as PluginState,

      call(fn: string, args?: unknown) {
        return callWorker(fn, args);
      },

      terminate() {
        worker.postMessage({ type: "terminate" });
        worker.terminate();
        onTerminate(pluginId);
        emit({ event: "plugin:terminate", pluginId });
      },

      emitTelemetry(event: string, payload?: any) {
        emit({ event, pluginId, payload });
      },
    };

    // Initialize the worker — send the WASM URL so it can self-load
    await callWorker("setup", { wasmUrl: manifest.entry, manifest });

    return workerInstance;
  }
}
