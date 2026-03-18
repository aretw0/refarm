# TEM Weights Training Guide

> This document is the single source of truth for anyone who wants to train
> the TEM Reasoning Engine and integrate the resulting weights into this repository.
> The architecture is complete — only the trained weight file is missing.

---

## 1. Current Status

The TEM plugin is **architecturally complete**. All inference logic, the
two-stage codegen pipeline, and the bridge to the Sovereign Graph are in place.
The only missing piece is a `bundle.json` produced from a trained checkpoint.

| Capability | Works today? | Notes |
| ---------- | ------------ | ----- |
| Inference step (shapes, finite values) | ✅ | `createRandomWeights()` is correct |
| Hebbian memory update (`M` matrix) | ✅ | Accumulates during an episode |
| `resetWalk()` clearing episode state | ✅ | Verified in integration tests |
| Attractor recall via `runAttractor` | ✅ | Mechanics correct |
| Storing `refarm:TemMemory` nodes | ✅ | Wired in commit `2f44439` |
| **noveltyScore as a familiarity signal** | ❌ | Needs trained weights |
| **Distinguishing novel vs. familiar patterns** | ❌ | Needs trained weights |
| **`predictionConfidence` converging toward 1** | ❌ | Needs trained weights |
| **4 `it.todo` integration tests** | ❌ | Activate once weights arrive |

**When does the missing weights actually matter in production?**
As soon as the system is used to detect anomalies or patterns in the Sovereign
Graph. `refarm:TemMemory` nodes _are_ being written (every `onEvent` call), but
the `refarm:noveltyScore` field carries no learned meaning — it is mathematically
valid noise until real weights are loaded.

---

## 2. The 4 Tests That Will Activate

All in `packages/plugin-tem/src/tem.integration.test.ts`.
To activate them: remove the `.todo` from each `it.todo` after the checklist
in Section 7 passes.

```text
Line 64:  "THEN noveltyScore should decrease over repeated observations"
          The same event pattern repeated N times must produce a monotonically
          decreasing noveltyScore. Validates that grid cells learned to encode
          abstract position consistently (familiarity signal).

Line 87:  "THEN noveltyScore for a new pattern is higher than for a familiar one"
          After 8 repetitions of a familiar pattern, a genuinely novel pattern
          must produce a significantly higher noveltyScore. Validates the
          novel-vs-familiar distinction.

Line 119: "THEN the next observation of the familiar pattern has high novelty again"
          After resetWalk() erases Hebbian memory (M) and grid cells (g), the
          previously-familiar pattern must show high novelty again. Validates
          that M is the sole memory source — the weights themselves do not
          memorise episodes.

Line 167: "THEN predictionConfidence should increase after learning the same sequence"
          predictionConfidence (cosine similarity between p_recalled and p_gen)
          must converge toward 1.0 after ~10 repetitions of the same sequence.
          Validates that attractor dynamics work with weights that produce
          coherent representations.
```

---

## 3. Prerequisites

```bash
# Python >= 3.9 with PyTorch (CPU build is enough for training on small graphs)
pip install torch --index-url https://download.pytorch.org/whl/cpu

# GPU build (>10x faster for larger graphs)
pip install torch --index-url https://download.pytorch.org/whl/cu121

# Reference torch_tem implementation
# https://github.com/jbakermans/torch_tem
# Any compatible implementation that exports the WeightsBundle schema (Section 4)
# can be used instead.
```

Node.js >= 18 is required for the sequence generation tool (Section 5).

---

## 4. WeightsBundle Contract

The TypeScript interface lives in
`packages/plugin-tem/src/core/weights.ts`. The JSON bundle must satisfy:

```typescript
interface WeightsBundle {
  version: string;         // semver string, e.g. "0.1.0"
  sourceCommit?: string;   // git commit hash of the torch_tem repo used

  config: {
    nG: number[];          // grid cell counts per frequency module
    nX: number;            // sensory observation dimension
    nActions: number;      // size of the action vocabulary
  };

  weights: {
    // Per-action GRU weights: [nActions][nModules]
    // Each module: { W_ih, W_hh, b_ih, b_hh, hiddenSize, inputSize }
    rnn: Array<Array<RNNModuleWeights>>;

    // Conjunction binding (g ⊗ x → p)
    conjunction: {
      W_tile: number[];    // [sumP × sumG] flattened
      W_repeat: number[];  // [sumP × nX] flattened
    };

    // MLP: abstract location g → place cells p
    placeGenerator: Array<{ W: number[]; b: number[]; inFeatures: number; outFeatures: number }>;

    // MLP: place cells p → sensory prediction x̂
    sensoryDecoder:  Array<{ W: number[]; b: number[]; inFeatures: number; outFeatures: number }>;
  };
}
```

### Default config dimensions

`nG=[10,10,8,6,6]`, `nX=64`, `nActions=16`, `hiddenSize=20`

| Tensor | Shape | Float count |
| ------ | ----- | ----------- |
| `sumG` | — | 40 |
| `sumP` | — | 120 (each nG[f] × 3) |
| RNN W_ih (per module, per action) | [20, nG[f]+16] | varies |
| RNN W_hh (per module, per action) | [20, 20] | 400 |
| **All 80 GRUs** (16 actions × 5 modules) | — | **~73,600** |
| conjunction.W_tile | [120, 40] | 4,800 |
| conjunction.W_repeat | [120, 64] | 7,680 |
| placeGenerator W | [120, 40] | 4,800 |
| sensoryDecoder W | [64, 120] | 7,680 |
| biases (all) | — | ~1,200 |
| **Total** | — | **~99,000 floats** |

---

## 5. Training Data

The TEM learns **transitions in the capability graph** of the Sovereign Graph:
which capability/event follows which. Use the tool below to produce the
training sequences.

### Tool: `tools/generate_tem_sequences.mjs`

A Node.js script with two operational modes.

**Mode `--synthetic`** — no running Tractor needed:

Generates random walks over the Refarm capability graph (derived from the
action vocabulary in `action-encoder.ts`). A 4×4 synthetic grid is sufficient
to make the 4 `it.todo` tests pass. Training takes ~5 minutes on CPU.

```bash
node tools/generate_tem_sequences.mjs \
  --synthetic \
  --walks 500 \
  --steps 20 \
  --out tools/sequences/synthetic.jsonl
```

**Mode `--from-storage`** — sequences extracted from real usage:

Reads `refarm:TemMemory` nodes already written by `storeNoveltyNode` (commit
`2f44439`), reconstructs chronological sequences, and re-encodes them offline
using the same deterministic encoders (`encodeAction` + `StructAwareEncoder`).

```bash
node tools/generate_tem_sequences.mjs \
  --from-storage ~/.refarm/prod.sqlite \
  --out tools/sequences/real.jsonl
```

**Output format** (`.jsonl`, one episode per line):

```json
{"steps": [{"action": 1, "obs": [0.12, -0.31, ...]}, {"action": 2, "obs": [...]}]}
{"steps": [{"action": 4, "obs": [0.05, 0.78, ...]}, ...]}
```

Each `obs` array has 64 floats (the `nX` dimension). Each `action` is an integer
from 0–15 matching the vocabulary below.

### Action vocabulary (current — 16 entries)

Defined in `packages/plugin-tem/src/encoding/action-encoder.ts`.

| ID | Event | Category |
| --- | --- | --- |
| 0 | (unknown) | fallback |
| 1 | `storage:io.storeNode` | storage |
| 2 | `storage:io.queryNodes` | storage |
| 3 | `storage:io.getNode` | storage |
| 4 | `plugin:load` | lifecycle |
| 5 | `plugin:terminate` | lifecycle |
| 6 | `plugin:log` | diagnostics |
| 7 | `api:call` | inter-plugin |
| 8 | `system:command_executed` | command |
| 9 | `system:command_failed` | command |
| 10 | `system:plugin_state_changed` | state |
| 11 | `system:security:canary_tripped` | security |
| 12 | `identity:guest_enabled` | identity |
| 13 | `identity:connected` | identity |
| 14 | `system:switch-tier` | storage |
| 15 | (reserved) | — |

**When `nActions` needs to grow:** if new semantically-significant event types
are added to Refarm (e.g. a new plugin category), increment `nActions` in
`DEFAULT_CONFIG` in `plugin.ts` and add entries to `ACTION_VOCAB` in
`action-encoder.ts`. This **invalidates existing weights** and requires
re-training from scratch.

### Continuous retraining cycle

As Refarm evolves (new plugins, new node types):

1. Run `generate_tem_sequences.mjs --from-storage` to extract new sequences
2. Re-train with the combined sequence set
3. Re-export via `export_tem_bundle.py`
4. Re-generate `weights.ts` via `tem-codegen`
5. Commit and re-activate the tests

Synthetic sequences validate the mechanics; real sequences improve production
novelty signal quality.

---

## 6. Pipeline

### Stage 1 — Python: checkpoint → bundle.json

```bash
# Real checkpoint (requires PyTorch):
python tools/export_tem_bundle.py \
  --checkpoint /path/to/torch_tem/checkpoints/tem_v1.pt \
  --out packages/plugin-tem/src/core/generated/bundle.json

# Dry-run with synthetic zero weights (no PyTorch, for CI validation only):
python tools/export_tem_bundle.py \
  --synthetic \
  --out packages/plugin-tem/src/core/generated/bundle.json
```

Available flags: `--n-g`, `--n-x`, `--n-actions`, `--hidden-size` for custom configs.
The script validates all tensor shapes before writing.

### Stage 2 — TypeScript: bundle.json → weights.ts

```bash
npx tem-codegen \
  --weights packages/plugin-tem/src/core/generated/bundle.json \
  --out packages/plugin-tem/src/core/generated/weights.ts
```

This runs `validateBundleShapes()` internally. If shapes are wrong it exits
with a non-zero code and a descriptive error.

---

## 7. Integration into the Repo

After generating `weights.ts`:

**a) Switch `plugin.ts` to use trained weights**

In `packages/plugin-tem/src/plugin.ts`, replace the `setup()` body:

```typescript
// Before (random weights):
const weights = createRandomWeights(
  DEFAULT_CONFIG.nG, DEFAULT_CONFIG.nX, DEFAULT_CONFIG.nActions,
);

// After (trained weights):
import { TEM_WEIGHTS_BUNDLE } from "./core/generated/weights";
const weights = loadWeightsFromBundle(TEM_WEIGHTS_BUNDLE);
```

**b) Run integration tests — expect all 4 todos to pass**

```bash
cd packages/plugin-tem && npx vitest run src/tem.integration.test.ts
```

**c) Activate the 4 todo tests**

Remove `.todo` from `it.todo(...)` at lines 64, 87, 119, and 167 of
`packages/plugin-tem/src/tem.integration.test.ts`.

**d) Commit**

```bash
git add packages/plugin-tem/src/core/generated/
git add packages/plugin-tem/src/plugin.ts
git add packages/plugin-tem/src/tem.integration.test.ts
git commit -m "feat(tem): integrate trained weights — activate 4 integration tests"
```

---

## 8. Verification Checklist

Before opening the PR, confirm all of these pass:

- [ ] `bundle.json` is accepted by `validateBundleShapes()` (no errors from `npx tem-codegen`)
- [ ] `weights.ts` generates without TypeScript errors (`npx tsc --noEmit`)
- [ ] All integration tests pass including the 4 previously-todo tests
- [ ] `noveltyScore` decreases monotonically over 5+ repetitions of the same event
- [ ] `noveltyScore` for a novel pattern > `noveltyScore` for a familiar pattern (after 8 reps)
- [ ] `predictionConfidence > 0.5` after a sequence of 10 repeated steps
