/**
 * Hebbian memory update for the Tolman-Eichenbaum Machine.
 *
 * The Hebbian matrix M is a 120×120 auto-associative memory (sumP × sumP).
 * Each step it is updated by the prediction-error signal:
 *
 *   M_t = clamp(λ·M_{t-1} + η·(p_inf ⊗ p_inf − p_gen ⊗ p_gen), −1, +1)
 *
 * Where:
 *   p_inf — place cells inferred from current observation (what we actually saw)
 *   p_gen — place cells generated from abstract location (what we predicted)
 *   η     — learning rate (default 0.5)
 *   λ     — exponential decay / forgetting (default 0.9999)
 *
 * The difference (p_inf⊗p_inf − p_gen⊗p_gen) is the prediction error signal.
 * Associations are strengthened where inference corrects prediction, enabling
 * rapid learning of new locations in fewer than 10 steps.
 *
 * @see Whittington et al. (2020) Cell 183(7), Eq. 7
 */

/**
 * Update the Hebbian memory matrix in-place.
 *
 * @param M     Flat Float32Array of shape [sumP × sumP], modified in-place
 * @param pInf  Place cells inferred from observation, shape [sumP]
 * @param pGen  Place cells generated from abstract location, shape [sumP]
 * @param eta   Hebbian learning rate (default 0.5)
 * @param lambda Exponential decay per step (default 0.9999)
 */
export function hebbianUpdate(
  M: Float32Array,
  pInf: Float32Array,
  pGen: Float32Array,
  eta: number = 0.5,
  lambda: number = 0.9999,
): void {
  const n = pInf.length;
  for (let i = 0; i < n; i++) {
    const infI = pInf[i];
    const genI = pGen[i];
    for (let j = 0; j < n; j++) {
      const idx = i * n + j;
      const delta = infI * pInf[j] - genI * pGen[j];
      const updated = lambda * M[idx] + eta * delta;
      // clamp to [-1, +1] — prevents runaway weight growth
      M[idx] = updated < -1 ? -1 : updated > 1 ? 1 : updated;
    }
  }
}

/**
 * Allocate a zeroed Hebbian memory matrix.
 * @param sumP Total place-cell count (default 120)
 */
export function createHebbianMemory(sumP: number = 120): Float32Array {
  return new Float32Array(sumP * sumP);
}
