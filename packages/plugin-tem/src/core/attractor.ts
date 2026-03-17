/**
 * Attractor dynamics for pattern completion in the TEM Hebbian memory.
 *
 * Given a partial cue (from abstract location g), the attractor converges
 * to a stored pattern in memory M via K fixed iterations:
 *
 *   h_0      = initialQuery
 *   h_{i+1} = clip(kappa * h_i + h_i @ M, -1, +1)
 *   result   = h_K
 *
 * This is a Hopfield-style attractor network. The kappa term provides
 * damping to prevent oscillation; K=10 fixed iterations is sufficient for
 * convergence to stored patterns without early-stop complexity.
 *
 * @see Whittington et al. (2020), Supplementary Methods
 */

/**
 * Run the attractor network to complete a partial pattern.
 *
 * @param M       Hebbian memory, flat Float32Array of shape [sumP x sumP]
 * @param query   Initial query vector, shape [sumP] — typically projected from g
 * @param kappa   Damping coefficient (default 0.8)
 * @param K       Number of fixed iterations (default 10)
 * @returns       Recalled pattern of shape [sumP]
 */
export function runAttractor(
  M: Float32Array,
  query: Float32Array,
  kappa: number = 0.8,
  K: number = 10,
): Float32Array {
  const n = query.length;
  const h = new Float32Array(query); // copy initial query

  for (let iter = 0; iter < K; iter++) {
    // h = kappa * h + h @ M   (row-vector times matrix)
    const hNext = new Float32Array(n);
    for (let j = 0; j < n; j++) {
      let acc = kappa * h[j];
      for (let i = 0; i < n; i++) {
        acc += h[i] * M[i * n + j];
      }
      // clip to [-1, +1]
      hNext[j] = acc < -1 ? -1 : acc > 1 ? 1 : acc;
    }
    h.set(hNext);
  }

  return h;
}

/**
 * Convergence metric: cosine similarity between recalled pattern and initial query.
 * Returns a value in [0, 1] where 1 = perfect alignment (full recall).
 */
export function convergenceScore(
  recalled: Float32Array,
  query: Float32Array,
): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < recalled.length; i++) {
    dot += recalled[i] * query[i];
    normA += recalled[i] * recalled[i];
    normB += query[i] * query[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom < 1e-8 ? 0 : dot / denom;
}
