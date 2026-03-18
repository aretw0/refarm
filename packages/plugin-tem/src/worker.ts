/**
 * Worker bootstrap for plugin-tem.
 *
 * When the WorkerRunner instantiates this plugin, it creates a Worker from
 * this entry point. The worker receives messages via the protocol defined
 * in WorkerRunner (packages/tractor/src/lib/worker-runner.ts):
 *
 *   → { type: "call", id, fn, args }
 *   ← { type: "result", id, result }  |  { type: "error", id, message }
 *   → { type: "terminate" }
 *
 * The "setup" call receives { wasmUrl, manifest } and initialises the plugin.
 *
 * Note: This file runs inside a Worker — no DOM access, no main thread state.
 */

import { integration, temApi, setStoreNodeFn } from "./plugin";
import { codegenApi } from "./codegen/plugin";

const API: Record<string, (...args: any[]) => unknown> = {
  // WIT integration interface
  setup: (_args: unknown) => {
    // Wire tractor-bridge store-node via bridge-call round-trip protocol
    setStoreNodeFn(async (nodeJson: string): Promise<void> => {
      const id = `bridge:${Date.now()}`;
      await new Promise<void>((resolve, reject) => {
        const onMsg = (ev: MessageEvent) => {
          const m = ev.data as any;
          if ((m.type === "bridge-result" || m.type === "bridge-error") && m.id === id) {
            self.removeEventListener("message", onMsg as any);
            if (m.type === "bridge-result") resolve();
            else reject(new Error(m.message));
          }
        };
        self.addEventListener("message", onMsg as any);
        self.postMessage({ type: "bridge-call", id, fn: "store-node", args: nodeJson });
      });
    });
    integration.setup();
    return null;
  },
  ingest: () => integration.ingest(),
  "on-event": (args: unknown) => {
    const { event, payload } = args as { event: string; payload?: string };
    integration.onEvent(event, payload);
    return null;
  },
  teardown: () => { integration.teardown(); return null; },
  "get-help-nodes": () => integration.getHelpNodes(),
  metadata: () => integration.metadata(),

  // TEM API
  "tem:step": (args: unknown) => {
    const { actionId, obsVec } = args as { actionId: number; obsVec: number[] };
    return temApi.step(actionId, obsVec);
  },
  "tem:recall": (args: unknown) => {
    const { locationHint } = args as { locationHint: number[] };
    return temApi.recall(locationHint);
  },
  "tem:reset-walk": () => { temApi.resetWalk(); return null; },
  "tem:last-novelty": () => temApi.lastNovelty(),

  // Codegen API
  "codegen:validate-bundle": (args: unknown) => {
    const { bundleJson } = args as { bundleJson: string };
    return codegenApi.validateBundle(bundleJson);
  },
  "codegen:generate-weights-ts": (args: unknown) => {
    const { bundleJson } = args as { bundleJson: string };
    return codegenApi.generateWeightsTs(bundleJson);
  },
};

// Listen for messages from WorkerRunner
if (typeof self !== "undefined") {
  self.addEventListener("message", async (ev: MessageEvent) => {
    const msg = ev.data as { type: string; id: string; fn: string; args?: unknown };

    if (msg.type === "terminate") {
      integration.teardown();
      self.close?.();
      return;
    }

    if (msg.type === "call") {
      const handler = API[msg.fn];
      if (!handler) {
        self.postMessage({ type: "error", id: msg.id, message: `Unknown fn: ${msg.fn}` });
        return;
      }
      try {
        const result = await handler(msg.args);
        self.postMessage({ type: "result", id: msg.id, result });
      } catch (e: any) {
        self.postMessage({ type: "error", id: msg.id, message: e?.message ?? String(e) });
      }
    }
  });
}
