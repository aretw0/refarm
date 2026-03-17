/**
 * TEM weight loader.
 *
 * Phase 1: loads from a JSON bundle (ONNX-extracted or manually defined).
 * Phase 2: generated TypeScript literals from @refarm.dev/tem-codegen CLI.
 *
 * Weight format mirrors the torch_tem architecture:
 * - rnn: per-action RNN weights [W_ih, W_hh, b_ih, b_hh] per module
 * - conjunction: projection matrix for g ⊗ x → p binding
 * - sensoryDecoder: MLP layers for p → x prediction
 */

export interface RNNModuleWeights {
  /** Input-hidden weight matrix: [hidden, input] flattened */
  W_ih: Float32Array;
  /** Hidden-hidden weight matrix: [hidden, hidden] flattened */
  W_hh: Float32Array;
  /** Input-hidden bias: [hidden] */
  b_ih: Float32Array;
  /** Hidden-hidden bias: [hidden] */
  b_hh: Float32Array;
  /** Hidden state size */
  hiddenSize: number;
  /** Input size (= n_g[f] + n_actions) */
  inputSize: number;
}

export interface ConjunctionWeights {
  /** Projection matrix tiling g into p-space: [sumP, sumG] flattened */
  W_tile: Float32Array;
  /** Projection matrix repeating x into p-space: [sumP, n_x] flattened */
  W_repeat: Float32Array;
}

export interface LinearLayerWeights {
  W: Float32Array;
  b: Float32Array;
  inFeatures: number;
  outFeatures: number;
}

export interface TEMWeights {
  /** Per-action RNN weights for path-integration (one per action, per freq module) */
  rnn: Array<Array<RNNModuleWeights>>; // [n_actions][n_modules]
  /** Conjunction binding weights */
  conjunction: ConjunctionWeights;
  /** MLP for generating place cells from abstract location */
  placeGenerator: LinearLayerWeights[];
  /** MLP for predicting sensory input from place cells */
  sensoryDecoder: LinearLayerWeights[];
}

export interface WeightsBundle {
  version: string;
  sourceCommit?: string;
  config: {
    nG: number[];
    nX: number;
    nActions: number;
  };
  weights: {
    rnn: Array<Array<{
      W_ih: number[];
      W_hh: number[];
      b_ih: number[];
      b_hh: number[];
      hiddenSize: number;
      inputSize: number;
    }>>;
    conjunction: {
      W_tile: number[];
      W_repeat: number[];
    };
    placeGenerator: Array<{ W: number[]; b: number[]; inFeatures: number; outFeatures: number }>;
    sensoryDecoder: Array<{ W: number[]; b: number[]; inFeatures: number; outFeatures: number }>;
  };
}

/** Load and convert a weights bundle JSON into typed Float32Array weights. */
export function loadWeightsFromBundle(bundle: WeightsBundle): TEMWeights {
  const { weights: w } = bundle;

  const rnn: TEMWeights["rnn"] = w.rnn.map((actionModules) =>
    actionModules.map((m) => ({
      W_ih: new Float32Array(m.W_ih),
      W_hh: new Float32Array(m.W_hh),
      b_ih: new Float32Array(m.b_ih),
      b_hh: new Float32Array(m.b_hh),
      hiddenSize: m.hiddenSize,
      inputSize: m.inputSize,
    })),
  );

  const conjunction: ConjunctionWeights = {
    W_tile: new Float32Array(w.conjunction.W_tile),
    W_repeat: new Float32Array(w.conjunction.W_repeat),
  };

  const toLinear = (layers: typeof w.placeGenerator): LinearLayerWeights[] =>
    layers.map((l) => ({
      W: new Float32Array(l.W),
      b: new Float32Array(l.b),
      inFeatures: l.inFeatures,
      outFeatures: l.outFeatures,
    }));

  return {
    rnn,
    conjunction,
    placeGenerator: toLinear(w.placeGenerator),
    sensoryDecoder: toLinear(w.sensoryDecoder),
  };
}

/** Create randomized weights for testing (not trained — just shape-correct). */
export function createRandomWeights(
  nG: number[],
  nX: number,
  nActions: number,
  hiddenSize: number = 20,
): TEMWeights {
  const nModules = nG.length;
  const nP = nG.map((g) => g * 3);
  const sumG = nG.reduce((a, b) => a + b, 0);
  const sumP = nP.reduce((a, b) => a + b, 0);

  const rand = (size: number) => {
    const a = new Float32Array(size);
    for (let i = 0; i < size; i++) a[i] = (Math.random() - 0.5) * 0.1;
    return a;
  };

  const rnn: TEMWeights["rnn"] = Array.from({ length: nActions }, () =>
    Array.from({ length: nModules }, (_, f) => ({
      W_ih: rand(hiddenSize * (nG[f] + nActions)),
      W_hh: rand(hiddenSize * hiddenSize),
      b_ih: rand(hiddenSize),
      b_hh: rand(hiddenSize),
      hiddenSize,
      inputSize: nG[f] + nActions,
    })),
  );

  return {
    rnn,
    conjunction: {
      W_tile: rand(sumP * sumG),
      W_repeat: rand(sumP * nX),
    },
    placeGenerator: [
      { W: rand(sumP * sumG), b: rand(sumP), inFeatures: sumG, outFeatures: sumP },
    ],
    sensoryDecoder: [
      { W: rand(nX * sumP), b: rand(nX), inFeatures: sumP, outFeatures: nX },
    ],
  };
}
