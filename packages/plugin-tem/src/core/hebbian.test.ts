import { describe, it, expect } from "vitest";
import { hebbianUpdate, createHebbianMemory } from "./hebbian";

describe("hebbianUpdate", () => {
  it("starts from zero and updates toward outer product", () => {
    const n = 4;
    const M = createHebbianMemory(n);
    const pInf = new Float32Array([1, 0, 0, 0]);
    const pGen = new Float32Array([0, 0, 0, 0]);

    hebbianUpdate(M, pInf, pGen, 0.5, 0.9999);

    // M[0,0] = clamp(0.9999*0 + 0.5*(1*1 - 0*0)) = 0.5
    expect(M[0]).toBeCloseTo(0.5);
    // M[0,1] = clamp(0.5*(1*0 - 0*0)) = 0
    expect(M[1]).toBeCloseTo(0);
  });

  it("clamps values to [-1, +1]", () => {
    const n = 2;
    const M = createHebbianMemory(n);
    // Fill with values near 1 to test clamping
    M.fill(0.9);
    const pInf = new Float32Array([1, 1]);
    const pGen = new Float32Array([0, 0]);

    // With eta=0.5, lambda=0.9999: 0.9999*0.9 + 0.5*1 = ~1.4 → clamped to 1
    hebbianUpdate(M, pInf, pGen, 0.5, 0.9999);

    for (let i = 0; i < M.length; i++) {
      expect(M[i]).toBeGreaterThanOrEqual(-1);
      expect(M[i]).toBeLessThanOrEqual(1);
    }
  });

  it("decays memory over time with no new signal", () => {
    const n = 4;
    const M = createHebbianMemory(n);
    M.fill(0.5);
    const zero = new Float32Array(n);

    // With identical pInf and pGen, outer product difference is zero → pure decay
    const sig = new Float32Array([0.5, 0.5, 0.5, 0.5]);
    hebbianUpdate(M, sig, sig, 0.5, 0.9);

    // All entries should have decayed: 0.9*0.5 + 0.5*(0) = 0.45
    expect(M[0]).toBeCloseTo(0.45, 3);
  });

  it("prediction-error signal strengthens on mismatch", () => {
    const n = 4;
    const M = createHebbianMemory(n);
    const pInf = new Float32Array([1, 0, 0, 0]);
    const pGen = new Float32Array([0, 1, 0, 0]); // complete mismatch

    hebbianUpdate(M, pInf, pGen, 1.0, 1.0); // no decay for clean test

    // M[0,0] = 1*1 - 0*0 = 1 (pInf strengthened)
    expect(M[0]).toBeCloseTo(1.0);
    // M[1,1] = 0*0 - 1*1 = -1 (pGen suppressed)
    expect(M[n + 1]).toBeCloseTo(-1.0);
  });
});

describe("createHebbianMemory", () => {
  it("creates correct size Float32Array", () => {
    const M = createHebbianMemory(120);
    expect(M.length).toBe(120 * 120);
    expect(M.every((v) => v === 0)).toBe(true);
  });
});
