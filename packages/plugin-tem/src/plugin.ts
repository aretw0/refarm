/**
 * TEM Plugin entry point — WIT bridge.
 *
 * Implements the refarm:plugin/integration interface (setup, ingest, on-event)
 * and exposes the tem-api (step, recall, reset-walk, last-novelty).
 *
 * When loaded as a Worker plugin, this module is bootstrapped by worker.ts
 * via Comlink. When loaded on the main thread (fallback), it runs directly.
 */

import { TEMInference, TEMConfig } from "./core/tem-inference";
import { createRandomWeights } from "./core/weights";
import { encodeAction } from "./encoding/action-encoder";
import { StructAwareEncoder } from "./encoding/obs-encoder";

// ─── Default Configuration (D6 from design spec) ────────────────────────────

const DEFAULT_CONFIG: TEMConfig = {
  nG: [10, 10, 8, 6, 6],
  nX: 64,
  nActions: 16,
  eta: 0.5,
  lambda: 0.9999,
  kappa: 0.8,
  attractorK: 10,
};

// ─── Tractor Bridge ──────────────────────────────────────────────────────────

let _storeNodeFn: ((nodeJson: string) => Promise<void>) | null = null;

export function setStoreNodeFn(fn: ((nodeJson: string) => Promise<void>) | null): void {
  _storeNodeFn = fn;
}

// ─── Plugin State ────────────────────────────────────────────────────────────

let tem: TEMInference | null = null;
let temState: ReturnType<TEMInference["createState"]> | null = null;
let obsEncoder: StructAwareEncoder = new StructAwareEncoder();
let lastNovelty = 0;

// ─── WIT: refarm:plugin/integration ─────────────────────────────────────────

export const integration = {
  /** Initialize TEM with random weights (Phase 1: until ONNX weights are available). */
  setup(): void {
    const weights = createRandomWeights(
      DEFAULT_CONFIG.nG,
      DEFAULT_CONFIG.nX,
      DEFAULT_CONFIG.nActions,
    );
    tem = new TEMInference(DEFAULT_CONFIG, weights);
    temState = tem.createState();
  },

  /** TEM does not ingest batch data — returns 0 processed items. */
  ingest(): number {
    return 0;
  },

  /** Receive a system event and perform a TEM inference step. */
  onEvent(event: string, payload?: string): void {
    if (!tem || !temState) return;

    const telemetryEvent = { event, payload: payload ? JSON.parse(payload) : undefined };
    const node = telemetryEvent.payload?.node ?? null;

    const actionVec = encodeAction(telemetryEvent);
    const obsVec = obsEncoder.encode(node, telemetryEvent);

    const output = tem.step(temState, actionVec, obsVec);
    lastNovelty = output.noveltyScore;

    // Store novelty signal back into the Sovereign Graph for external consumers
    // (non-blocking; errors are silently ignored to not block event processing)
    storeNoveltyNode(event, output.noveltyScore, output.predictionConfidence).catch(
      () => {},
    );
  },

  /** No explicit teardown needed — garbage collection handles Float32Arrays. */
  teardown(): void {
    tem = null;
    temState = null;
  },

  getHelpNodes(): string[] {
    return [
      JSON.stringify({
        "@type": "refarm:HelpNode",
        "@id": "urn:refarm:tem:help",
        "name": "TEM Reasoning Engine",
        "description":
          "Observes system events and learns the Sovereign Graph topology using Hebbian associative memory. Exposes novelty scoring and pattern recall.",
        "refarm:sourcePlugin": "refarm:tem",
      }),
    ];
  },

  metadata(): unknown {
    return {
      id: "refarm:tem",
      name: "TEM Reasoning Engine",
      version: "0.1.0",
    };
  },
};

// ─── TEM API ─────────────────────────────────────────────────────────────────

export const temApi = {
  step(
    actionId: number,
    obsVec: number[],
  ): { tag: "ok"; val: ReturnType<TEMInference["step"]> } | { tag: "err"; val: string } {
    if (!tem || !temState) return { tag: "err", val: "TEM not initialised — call setup() first" };

    const action = new Float32Array(DEFAULT_CONFIG.nActions);
    action[actionId % DEFAULT_CONFIG.nActions] = 1.0;

    const obs = new Float32Array(obsVec);
    const output = tem.step(temState, action, obs);
    lastNovelty = output.noveltyScore;

    return { tag: "ok", val: output };
  },

  recall(
    locationHint: number[],
  ): { tag: "ok"; val: number[] } | { tag: "err"; val: string } {
    if (!tem || !temState) return { tag: "err", val: "TEM not initialised" };

    // Import runAttractor lazily to avoid circular dependency
    const { runAttractor } = require("./core/attractor");
    const hint = new Float32Array(locationHint);
    const recalled = runAttractor(temState.M, hint);

    return { tag: "ok", val: Array.from(recalled) };
  },

  resetWalk(): void {
    if (tem && temState) tem.resetWalk(temState);
  },

  lastNovelty(): number {
    return lastNovelty;
  },
};

// ─── Internal: Store Novelty Signal ──────────────────────────────────────────

async function storeNoveltyNode(
  triggerEvent: string,
  noveltyScore: number,
  confidence: number,
): Promise<void> {
  if (!_storeNodeFn) return;
  const nodeJson = JSON.stringify({
    "@context": "https://refarm.dev/context/v1",
    "@type": "refarm:TemMemory",
    "@id": `urn:refarm:tem:novelty:${Date.now()}`,
    "refarm:triggerEvent": triggerEvent,
    "refarm:noveltyScore": noveltyScore,
    "refarm:predictionConfidence": confidence,
    "refarm:timestamp": new Date().toISOString(),
    "refarm:sourcePlugin": "refarm:tem",
  });
  await _storeNodeFn(nodeJson);
}
