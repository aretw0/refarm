/**
 * TDD Tests: codegen WIT bridge
 *
 * Written BEFORE implementation — red phase.
 * Tests the codegenApi object that wraps the pure codegen functions
 * for the WIT/Worker interface.
 */

import { describe, it, expect } from "vitest";
import { codegenApi } from "./plugin";

// ─── Shared fixture ────────────────────────────────────────────────────────

const CONFIG = { nG: [4, 4], nX: 8, nActions: 4 };
const HIDDEN_SIZE = 6;
const SUM_G = 8;
const SUM_P = 24;

function makeValidBundle() {
  const zeros = (n: number) => Array(n).fill(0);
  return {
    version: "0.1.0",
    config: CONFIG,
    weights: {
      rnn: Array.from({ length: CONFIG.nActions }, () =>
        Array.from({ length: CONFIG.nG.length }, (_, f) => ({
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

// ─── validateBundle ────────────────────────────────────────────────────────

describe("codegenApi.validateBundle", () => {
  it("returns ok with config JSON for a valid bundle", () => {
    const result = codegenApi.validateBundle(JSON.stringify(makeValidBundle()));

    expect(result.tag).toBe("ok");
    if (result.tag === "ok") {
      const config = JSON.parse(result.val);
      expect(config.nG).toEqual(CONFIG.nG);
      expect(config.nX).toBe(CONFIG.nX);
      expect(config.nActions).toBe(CONFIG.nActions);
    }
  });

  it("returns err for a bundle with wrong W_ih shape", () => {
    const bundle = makeValidBundle();
    bundle.weights.rnn[0][0].W_ih = [1, 2]; // wrong size
    const result = codegenApi.validateBundle(JSON.stringify(bundle));

    expect(result.tag).toBe("err");
    if (result.tag === "err") {
      expect(result.val).toMatch(/W_ih/);
    }
  });

  it("returns err for invalid JSON", () => {
    const result = codegenApi.validateBundle("not-valid-json{{{");
    expect(result.tag).toBe("err");
  });

  it("returns err for non-object JSON", () => {
    const result = codegenApi.validateBundle("42");
    expect(result.tag).toBe("err");
  });
});

// ─── generateWeightsTs ─────────────────────────────────────────────────────

describe("codegenApi.generateWeightsTs", () => {
  it("returns ok with TypeScript source for a valid bundle", () => {
    const result = codegenApi.generateWeightsTs(JSON.stringify(makeValidBundle()));

    expect(result.tag).toBe("ok");
    if (result.tag === "ok") {
      expect(result.val).toContain("AUTO-GENERATED");
      expect(result.val).toContain("TEM_WEIGHTS_BUNDLE");
      expect(result.val).toContain("WeightsBundle");
    }
  });

  it("returns err for invalid JSON", () => {
    const result = codegenApi.generateWeightsTs("{{invalid");
    expect(result.tag).toBe("err");
  });

  it("returns err for bundle with wrong conjunction shape", () => {
    const bundle = makeValidBundle();
    bundle.weights.conjunction.W_tile = [1, 2]; // wrong size
    const result = codegenApi.generateWeightsTs(JSON.stringify(bundle));

    expect(result.tag).toBe("err");
    if (result.tag === "err") {
      expect(result.val).toMatch(/W_tile/);
    }
  });

  it("returned TypeScript source contains the bundle version", () => {
    const result = codegenApi.generateWeightsTs(JSON.stringify(makeValidBundle()));

    expect(result.tag).toBe("ok");
    if (result.tag === "ok") {
      expect(result.val).toContain('"0.1.0"');
    }
  });
});
