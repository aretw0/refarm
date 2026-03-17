/**
 * TEM Inference Engine — TypeScript port of torch_tem.
 *
 * Implements the three-stream Tolman-Eichenbaum Machine for inference-only use.
 * Frozen RNN + conjunction weights are loaded once; the Hebbian memory M is
 * updated online every step (non-differentiably) to learn new environments in
 * fewer than 10 steps without any retraining.
 *
 * Architecture constants (D6 from design spec):
 *   n_g = [10, 10, 8, 6, 6]  — grid cell neurons per frequency module
 *   n_p = [30, 30, 24, 18, 18] — place cell neurons (3x conjunction)
 *   sumP = 120                — Hebbian matrix: 120x120
 *
 * @see docs/research/tem-sovereign-graph-design.md
 * @see Whittington et al. (2020) Cell 183(7)
 */

import { hebbianUpdate, createHebbianMemory } from "./hebbian";
import { runAttractor, convergenceScore } from "./attractor";
import type { TEMWeights, LinearLayerWeights } from "./weights";

export interface TEMConfig {
  /** Grid cell neurons per frequency module, e.g. [10, 10, 8, 6, 6] */
  nG: number[];
  /** Sensory input dimension */
  nX: number;
  /** Number of distinct action types */
  nActions: number;
  /** Hebbian learning rate (default 0.5) */
  eta?: number;
  /** Hebbian forgetting decay per step (default 0.9999) */
  lambda?: number;
  /** Attractor damping coefficient (default 0.8) */
  kappa?: number;
  /** Fixed attractor iterations (default 10) */
  attractorK?: number;
}

export interface TEMState {
  /** Abstract location per frequency module, shape [n_g[f]] each */
  g: Float32Array[];
  /** RNN hidden state per frequency module, shape [hiddenSize] each */
  hiddens: Float32Array[];
  /** Hebbian memory, flat shape [sumP x sumP] */
  M: Float32Array;
}

export interface TEMOutput {
  /** Inferred place cells (observation-grounded), shape [sumP] */
  pInferred: Float32Array;
  /** Recalled place cells (from memory attractor), shape [sumP] */
  pRecalled: Float32Array;
  /** Sensory prediction error: ||x_predicted - x_actual|| (lower = more familiar) */
  noveltyScore: number;
  /** Attractor convergence: cosine similarity between recalled and generated (higher = confident) */
  predictionConfidence: number;
}

export class TEMInference {
  private readonly nG: number[];
  private readonly nP: number[];
  private readonly sumP: number;
  private readonly sumG: number;
  private readonly eta: number;
  private readonly lambda: number;
  private readonly kappa: number;
  private readonly attractorK: number;

  constructor(
    private readonly config: TEMConfig,
    private readonly weights: TEMWeights,
  ) {
    this.nG = config.nG;
    this.nP = config.nG.map((g) => g * 3);
    this.sumP = this.nP.reduce((a, b) => a + b, 0);
    this.sumG = this.nG.reduce((a, b) => a + b, 0);
    this.eta = config.eta ?? 0.5;
    this.lambda = config.lambda ?? 0.9999;
    this.kappa = config.kappa ?? 0.8;
    this.attractorK = config.attractorK ?? 10;
  }

  /** Create a zeroed initial state for a new walk. */
  createState(): TEMState {
    return {
      g: this.nG.map((n) => new Float32Array(n)),
      hiddens: this.weights.rnn[0].map((m) => new Float32Array(m.hiddenSize)),
      M: createHebbianMemory(this.sumP),
    };
  }

  /** Reset state for a new walk (new environment or context switch). */
  resetWalk(state: TEMState): void {
    state.g.forEach((g) => g.fill(0));
    state.hiddens.forEach((h) => h.fill(0));
    state.M.fill(0);
  }

  /**
   * Perform one inference step.
   *
   * @param state   Current TEM state (mutated in-place: g, hiddens, M updated)
   * @param action  Action vector, shape [nActions] (typically 1-hot)
   * @param obs     Observation vector, shape [nX]
   */
  step(state: TEMState, action: Float32Array, obs: Float32Array): TEMOutput {
    // 1. Path-integration: update abstract location g per frequency module
    this.updateAbstractLocation(state, action);

    // 2. Generative: predict place cells from abstract location (before seeing obs)
    const pGen = this.generatePlaceCells(state.g);

    // 3. Conjunction: infer grounded place cells from g + obs
    const pInf = this.inferConjunction(state.g, obs);

    // 4. Hebbian update: strengthen associations where inference corrects prediction
    hebbianUpdate(state.M, pInf, pGen, this.eta, this.lambda);

    // 5. Attractor: recall pattern from memory starting from pGen
    const pRec = runAttractor(state.M, pGen, this.kappa, this.attractorK);

    // 6. Sensory prediction: decode recalled place cells back to observation space
    const xPred = this.decodeSensory(pRec);

    // 7. Compute output metrics
    const noveltyScore = euclideanDistance(xPred, obs);
    const predictionConfidence = convergenceScore(pRec, pGen);

    return {
      pInferred: pInf,
      pRecalled: pRec,
      noveltyScore,
      predictionConfidence,
    };
  }

  // ─── Private: Stream Computations ───────────────────────────────────────────

  /**
   * Path-integration RNN: update abstract location g from action.
   *
   * For each frequency module f:
   *   g_t[f] = tanh(W_ih[a] * [g_{t-1}[f]; action] + b_ih[a]
   *              + W_hh[a] * h_{t-1}[f]         + b_hh[a])
   *
   * USER CONTRIBUTION POINT: This is the most research-adjacent function.
   * The RNN transition per module uses the loaded weight matrices for the
   * given action index. Consider implementing this if you want to customize
   * the path-integration dynamics (e.g. using a GRU instead of vanilla RNN).
   */
  private updateAbstractLocation(state: TEMState, action: Float32Array): void {
    // Find the dominant action index for weight lookup
    const actionIdx = argmax(action);
    const rnnWeights = this.weights.rnn[actionIdx] ?? this.weights.rnn[0];

    for (let f = 0; f < this.nG.length; f++) {
      const w = rnnWeights[f];
      const g = state.g[f];
      const h = state.hiddens[f];

      // Concatenate g[f] and action as input
      const input = new Float32Array(w.inputSize);
      input.set(g, 0);
      input.set(action, g.length);

      // Vanilla RNN: h_new = tanh(W_ih * input + b_ih + W_hh * h + b_hh)
      const hNew = new Float32Array(w.hiddenSize);
      for (let out = 0; out < w.hiddenSize; out++) {
        let acc = w.b_ih[out] + w.b_hh[out];
        for (let inp = 0; inp < w.inputSize; inp++) {
          acc += w.W_ih[out * w.inputSize + inp] * input[inp];
        }
        for (let hIdx = 0; hIdx < w.hiddenSize; hIdx++) {
          acc += w.W_hh[out * w.hiddenSize + hIdx] * h[hIdx];
        }
        hNew[out] = Math.tanh(acc);
      }

      // Update hidden state and abstract location
      state.hiddens[f].set(hNew);
      // g[f] is a projection of h[f] onto n_g[f] dims (slice or use W_out if available)
      // For this implementation: use first n_g[f] dims of h as abstract location
      const gNew = hNew.slice(0, g.length);
      state.g[f].set(gNew);
    }
  }

  /** Generate place cells from abstract location via MLP. */
  private generatePlaceCells(g: Float32Array[]): Float32Array {
    const gCat = concatenate(g);
    return mlpForward(this.weights.placeGenerator, gCat);
  }

  /**
   * Infer grounded place cells from abstract location + observation.
   * Conjunction: tiles g across observation dims and repeats obs across g dims.
   */
  private inferConjunction(g: Float32Array[], obs: Float32Array): Float32Array {
    const { W_tile, W_repeat } = this.weights.conjunction;
    const gCat = concatenate(g);

    const pTile = matMulVec(W_tile, gCat, this.sumP, this.sumG);
    const pRep = matMulVec(W_repeat, obs, this.sumP, obs.length);

    // Element-wise product of the two projections (Hadamard / conjunction binding)
    const p = new Float32Array(this.sumP);
    for (let i = 0; i < this.sumP; i++) {
      p[i] = Math.tanh(pTile[i] * pRep[i]);
    }
    return p;
  }

  /** Decode place cells back to sensory space via MLP. */
  private decodeSensory(p: Float32Array): Float32Array {
    return mlpForward(this.weights.sensoryDecoder, p);
  }
}

// ─── Math Utilities ─────────────────────────────────────────────────────────

function concatenate(arrays: Float32Array[]): Float32Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function matMulVec(
  W: Float32Array,
  x: Float32Array,
  outDim: number,
  inDim: number,
): Float32Array {
  const out = new Float32Array(outDim);
  for (let i = 0; i < outDim; i++) {
    let acc = 0;
    for (let j = 0; j < inDim; j++) {
      acc += W[i * inDim + j] * x[j];
    }
    out[i] = acc;
  }
  return out;
}

function mlpForward(layers: LinearLayerWeights[], x: Float32Array): Float32Array {
  let h = x;
  for (let i = 0; i < layers.length; i++) {
    const { W, b, outFeatures, inFeatures } = layers[i];
    const out = new Float32Array(outFeatures);
    for (let j = 0; j < outFeatures; j++) {
      let acc = b[j];
      for (let k = 0; k < inFeatures; k++) {
        acc += W[j * inFeatures + k] * h[k];
      }
      // ReLU for hidden layers, identity for last layer
      out[j] = i < layers.length - 1 ? Math.max(0, acc) : acc;
    }
    h = out;
  }
  return h;
}

function euclideanDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function argmax(v: Float32Array): number {
  let maxIdx = 0;
  let maxVal = v[0];
  for (let i = 1; i < v.length; i++) {
    if (v[i] > maxVal) {
      maxVal = v[i];
      maxIdx = i;
    }
  }
  return maxIdx;
}
