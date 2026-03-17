// TEM Sovereign Graph Reasoning Engine
// Public API for use as a TypeScript library (non-plugin usage)

export { TEMInference } from "./core/tem-inference";
export type { TEMConfig, TEMState, TEMOutput } from "./core/tem-inference";
export { hebbianUpdate, createHebbianMemory } from "./core/hebbian";
export { runAttractor, convergenceScore } from "./core/attractor";
export { loadWeightsFromBundle, createRandomWeights } from "./core/weights";
export type { TEMWeights, WeightsBundle } from "./core/weights";
export { StructAwareEncoder } from "./encoding/obs-encoder";
export type { ObsEncoder, SovereignNodeLike, TelemetryEventLike } from "./encoding/obs-encoder";
export { encodeAction, resolveActionIndex, ACTION_VOCAB, N_ACTIONS } from "./encoding/action-encoder";
export { SLOTS, TYPE_VOCAB, N_X } from "./encoding/schema-slots";
