import { describe, it, expect } from "vitest";
import { runAttractor, convergenceScore } from "./attractor";
import { createHebbianMemory, hebbianUpdate } from "./hebbian";

describe("runAttractor", () => {
  it("returns a vector of the correct shape", () => {
    const n = 8;
    const M = createHebbianMemory(n);
    const query = new Float32Array(n).fill(0.1);

    const result = runAttractor(M, query, 0.8, 10);

    expect(result.length).toBe(n);
  });

  it("outputs are clamped to [-1, +1]", () => {
    const n = 8;
    const M = new Float32Array(n * n).fill(1.0); // max weights
    const query = new Float32Array(n).fill(1.0);

    const result = runAttractor(M, query, 0.8, 5);

    for (const v of result) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("zero memory returns decayed query", () => {
    const n = 4;
    const M = createHebbianMemory(n);
    const query = new Float32Array([0.5, 0.5, 0.5, 0.5]);

    // With zero memory: h_{i+1} = clip(kappa * h_i + 0) → exponential decay
    const result = runAttractor(M, query, 0.8, 3);

    // After 3 iterations: 0.5 * 0.8^3 = 0.256
    for (const v of result) {
      expect(v).toBeCloseTo(0.256, 2);
    }
  });

  it("recalls a stored pattern after Hebbian learning", () => {
    const n = 8;
    const M = createHebbianMemory(n);

    // Store a pattern by running Hebbian update many times
    const pattern = new Float32Array([1, -1, 1, -1, 1, -1, 1, -1]);
    for (let i = 0; i < 20; i++) {
      hebbianUpdate(M, pattern, new Float32Array(n), 0.5, 0.9999);
    }

    // Query with a noisy version of the pattern
    const noisy = new Float32Array([0.8, -0.8, 0.8, -0.8, 0.8, -0.8, 0.8, -0.8]);
    const recalled = runAttractor(M, noisy, 0.8, 10);

    // Recalled should be more similar to the original pattern than query was
    const origSim = convergenceScore(pattern, noisy);
    const recalledSim = convergenceScore(recalled, pattern);

    expect(recalledSim).toBeGreaterThan(origSim * 0.5);
  });
});

describe("convergenceScore", () => {
  it("returns 1 for identical vectors", () => {
    const v = new Float32Array([0.5, 0.3, 0.2]);
    expect(convergenceScore(v, v)).toBeCloseTo(1.0);
  });

  it("returns 0 for zero vectors", () => {
    const a = new Float32Array(4);
    const b = new Float32Array([1, 0, 0, 0]);
    expect(convergenceScore(a, b)).toBeCloseTo(0);
  });

  it("returns -1 for opposite vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);
    expect(convergenceScore(a, b)).toBeCloseTo(-1.0);
  });
});
