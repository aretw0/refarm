/**
 * TDD Tests: tem-codegen CLI
 *
 * Written BEFORE implementation — red phase.
 * These tests describe the contracts of:
 *   1. bundleToTypeScript() — serialize a WeightsBundle to a .ts source string
 *   2. roundtrip integrity — loadWeightsFromBundle(bundle) recovers correct shapes
 *   3. CLI output — generated TypeScript is syntactically valid
 */

import { describe, it, expect } from "vitest";
import { bundleToTypeScript, validateBundleShapes } from "./weights-to-ts";
import { loadWeightsFromBundle, type WeightsBundle } from "../core/weights";

// ─── Shared fixture ────────────────────────────────────────────────────────

const CONFIG = { nG: [4, 4], nX: 8, nActions: 4 };
const N_MODULES = CONFIG.nG.length;
const HIDDEN_SIZE = 6;
const SUM_G = CONFIG.nG.reduce((a, b) => a + b, 0); // 8
const SUM_P = CONFIG.nG.reduce((a, b) => a + b * 3, 0); // 24

function makeBundle(): WeightsBundle {
  const zeros = (n: number) => Array(n).fill(0);

  return {
    version: "0.1.0",
    config: CONFIG,
    weights: {
      rnn: Array.from({ length: CONFIG.nActions }, () =>
        Array.from({ length: N_MODULES }, (_, f) => ({
          W_ih: zeros(HIDDEN_SIZE * (CONFIG.nG[f] + CONFIG.nActions)),
          W_hh: zeros(HIDDEN_SIZE * HIDDEN_SIZE),
          b_ih: zeros(HIDDEN_SIZE),
          b_hh: zeros(HIDDEN_SIZE),
          hiddenSize: HIDDEN_SIZE,
          inputSize: CONFIG.nG[f] + CONFIG.nActions,
        })),
      ),
      conjunction: {
        W_tile: zeros(SUM_P * SUM_G),
        W_repeat: zeros(SUM_P * CONFIG.nX),
      },
      placeGenerator: [
        { W: zeros(SUM_P * SUM_G), b: zeros(SUM_P), inFeatures: SUM_G, outFeatures: SUM_P },
      ],
      sensoryDecoder: [
        { W: zeros(CONFIG.nX * SUM_P), b: zeros(CONFIG.nX), inFeatures: SUM_P, outFeatures: CONFIG.nX },
      ],
    },
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("validateBundleShapes", () => {
  it("passes for a correctly shaped bundle", () => {
    const bundle = makeBundle();
    expect(() => validateBundleShapes(bundle)).not.toThrow();
  });

  it("throws when RNN W_ih has wrong size", () => {
    const bundle = makeBundle();
    bundle.weights.rnn[0][0].W_ih = [1, 2]; // wrong size
    expect(() => validateBundleShapes(bundle)).toThrow(/W_ih/);
  });

  it("throws when conjunction W_tile has wrong size", () => {
    const bundle = makeBundle();
    bundle.weights.conjunction.W_tile = [1, 2]; // wrong size
    expect(() => validateBundleShapes(bundle)).toThrow(/W_tile/);
  });
});

describe("bundleToTypeScript", () => {
  it("returns a non-empty string", () => {
    const src = bundleToTypeScript(makeBundle());
    expect(typeof src).toBe("string");
    expect(src.length).toBeGreaterThan(100);
  });

  it("output contains the WeightsBundle export", () => {
    const src = bundleToTypeScript(makeBundle());
    expect(src).toContain("export const TEM_WEIGHTS_BUNDLE");
    expect(src).toContain("WeightsBundle");
  });

  it("output contains the bundle version", () => {
    const src = bundleToTypeScript(makeBundle());
    expect(src).toContain('"0.1.0"');
  });

  it("generated source can be parsed as JSON (embedded bundle is valid)", () => {
    const src = bundleToTypeScript(makeBundle());
    // Extract the JSON literal between first `{` and last `}` after the assignment
    const match = src.match(/= (\{[\s\S]+\}) satisfies WeightsBundle/);
    expect(match).not.toBeNull();
    expect(() => JSON.parse(match![1])).not.toThrow();
  });
});

describe("loadWeightsFromBundle roundtrip", () => {
  it("recovers correct RNN tensor shapes", () => {
    const bundle = makeBundle();
    const weights = loadWeightsFromBundle(bundle);

    expect(weights.rnn.length).toBe(CONFIG.nActions);
    expect(weights.rnn[0].length).toBe(N_MODULES);
    expect(weights.rnn[0][0].W_ih.length).toBe(HIDDEN_SIZE * (CONFIG.nG[0] + CONFIG.nActions));
    expect(weights.rnn[0][0].W_hh.length).toBe(HIDDEN_SIZE * HIDDEN_SIZE);
  });

  it("recovers correct conjunction tensor shapes", () => {
    const bundle = makeBundle();
    const weights = loadWeightsFromBundle(bundle);

    expect(weights.conjunction.W_tile.length).toBe(SUM_P * SUM_G);
    expect(weights.conjunction.W_repeat.length).toBe(SUM_P * CONFIG.nX);
  });

  it("all tensors are Float32Array instances", () => {
    const bundle = makeBundle();
    const weights = loadWeightsFromBundle(bundle);

    expect(weights.rnn[0][0].W_ih).toBeInstanceOf(Float32Array);
    expect(weights.conjunction.W_tile).toBeInstanceOf(Float32Array);
    expect(weights.placeGenerator[0].W).toBeInstanceOf(Float32Array);
    expect(weights.sensoryDecoder[0].W).toBeInstanceOf(Float32Array);
  });
});
