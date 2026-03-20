# TEM Plugin — Architecture Blueprint

> This document translates the TEM research into an implementation blueprint for contributors.
> **Status**: Blueprint (TypeScript implementation exists; WASM migration not yet done)
> **Research basis**: [`docs/research/tem-sovereign-graph-design.md`](../../../docs/research/tem-sovereign-graph-design.md)

---

## What is the TEM Plugin?

The TEM plugin embeds the **Tolman-Eichenbaum Machine** (Whittington et al. 2020, *Cell* 183(7)) as a Refarm WASM plugin. It acts as the "hippocampus" of the Sovereign Graph — a bio-inspired cognitive map engine that:

- Learns the **relational topology** of graph traversals without backpropagation
- Predicts which nodes and capabilities are likely to appear together
- Detects **novelty** by comparing prediction against observation in real time
- Runs entirely **in-browser**, within a WebWorker, with ~160k FLOPs per step (~1ms in V8)

Unlike a language model, TEM does not generate text. It continuously updates an episodic memory matrix as the user traverses the Sovereign Graph, and emits two scalar primitives per step: `noveltyScore` and `predictionConfidence`. These primitives are the system's signal for whether a pattern is familiar or unexpected.

---

## Current Implementation Status

| Component | Status | Location |
|-----------|--------|----------|
| TypeScript core (RNN, Hebbian, attractor) | Working | `src/core/` |
| Action + observation encoders | Working | `src/encoding/` |
| Codegen pipeline (weights export) | Working | `src/codegen/` |
| WIT interface definitions | Defined (file only) | `wit/tem.wit` |
| WASM plugin wrapper (`plugin.ts` WIT bridge) | Scaffolded | `src/plugin.ts` |
| Comlink worker bootstrap | Scaffolded | `src/worker.ts` |
| WorkerRunner + MainThreadRunner (tractor) | Working | `packages/tractor/src/lib/` |
| Trained weights integration | Not yet | `src/core/generated/weights.ts` |
| WASM compilation + tractor host loading | Not yet | — |

The TypeScript core is the ground truth for all inference logic. The WASM migration will wrap this core, not replace it.

---

## Architecture: Three Streams

TEM separates **where** from **what** using three parallel neural streams:

### G-stream — Abstract Location (Grid Cells / MEC)

The G-stream tracks the agent's position in the **capability topology** of the Sovereign Graph, independent of what data is present at each node.

- Updated by path integration: `g_t[f] = RNN(g_{t-1}[f], action_t)` per frequency module
- Five frequency modules with `n_g = [10, 10, 8, 6, 6]` neurons each (`sumG = 40`)
- Emergent representations: grid cells, band cells, and border cells arise at different frequencies
- **Sovereign Graph analogue**: abstract position in the capability/resource topology — "the agent is near a `PluginManifest` node after a `plugin:load` action"

### X-stream — Sensory Input

The X-stream receives the current observation: what the agent perceives at the current node.

- A 64-dimensional struct-aware embedding of the `SovereignNode` and `TelemetryEvent`
- Dimensionally stable: each slot maps to a specific semantic category in the JSON-LD schema (see D5 — Struct-Aware Encoding below)
- **Sovereign Graph analogue**: `SovereignNode` metadata + `TelemetryEvent` payload encoded into a fixed-size float vector

### P-stream — Grounded Location (Place Cells / Hippocampus)

The P-stream **binds** abstract location (G) with sensory content (X), forming the conjunction that drives episodic memory.

- `n_p[f] = 3 × n_g[f]` neurons per module (tripling for conjunction)
- `sumP = 120` total place cell neurons → a **120×120 Hebbian memory matrix**
- Two variants per step: `p_inf` (inferred from current observation) and `p_gen` (predicted from abstract location before seeing the observation)
- **Sovereign Graph analogue**: "which actual node instance am I at, and what does it contain"

### Hebbian Memory Matrix

The core episodic memory. Updated every step without gradient descent:

```
M_t = clamp(λ × M_{t-1} + η × (p_inf ⊗ p_inf − p_gen ⊗ p_gen), −1, +1)
```

| Parameter | Value | Meaning |
|-----------|-------|---------|
| `eta` (η) | 0.5 | Hebbian learning rate |
| `lambda` (λ) | 0.9999 | Exponential forgetting (avoids catastrophic interference) |
| `kappa` (κ) | 0.8 | Attractor damping coefficient |
| `K_attractor` | 10 | Fixed attractor iterations for pattern completion |

The difference `p_inf − p_gen` is the **prediction error signal**: it strengthens associations where the current observation corrects the prior prediction.

### Attractor Retrieval (Pattern Completion)

Retrieves full place-cell patterns from partial cues:

```
h_0 = project(g_t)        // initialise from abstract location
for i in 0..K:
  h_{i+1} = kappa × h_i + h_i @ M
  h_{i+1} = clip(h_{i+1}, −1, +1)
p_retrieved = h_K
```

This allows TEM to complete the pattern: "given this sequence of actions, I expect to see a node with these identity fields."

---

## Data Flow: SovereignNode → TEM → Novelty Score

```
TelemetryEvent
  │
  ├─ event string ──→ ActionEncoder ──→ action_id: u32  (1-hot index, 0–15)
  │
  └─ SovereignNode ─→ ObsEncoder   ──→ obs_vec: float32[64]  (struct-aware slots)
                                                │
                                                ▼
                                        TEM Inference (one step)
                                          ┌────────────────────────────────┐
                                          │  G-stream: g_t = RNN(g_{t-1}, action_id)    │
                                          │  P-gen:    p_gen = conjunction(g_t)         │
                                          │  P-inf:    p_inf = conjunction(g_t, obs_vec)│
                                          │  Attractor: p_recalled = retrieve(M, g_t)  │
                                          │  Hebbian:  M_t = update(M_{t-1}, p_inf, p_gen) │
                                          └────────────────────────────────┘
                                                │
                                         TEM Output (per step)
                                          ├─ novelty_score:         float32  (L2 prediction error; lower = familiar)
                                          ├─ prediction_confidence: float32  (cosine(p_recalled, p_gen))
                                          ├─ p_inferred:            float32[120]
                                          └─ p_recalled:            float32[120]
                                                │
                                        storeNoveltyNode()
                                          └─→ Sovereign Graph  (refarm:TemMemory node, persisted via Tractor bridge)
```

### Action Space Mapping (D4)

`TelemetryEvent.event` strings map to 1-hot integer indices. The current 16-action vocabulary:

| TelemetryEvent | Action index |
|----------------|-------------|
| `storage:io.storeNode` | 0 |
| `storage:io.queryNodes` | 1 |
| `plugin:load` | 2 |
| `plugin:terminate` | 3 |
| `api:call.OutputApi` | 4 |
| `api:call.IdentityApi` | 5 |
| `system:command_executed` | 6 |
| `system:security:*` | 7 |
| *(reserved for future API call types)* | 8–15 |

Actions represent **transitions in the capability graph** — the structural topology that the G-stream learns to represent. When the Sovereign Agent creates new plugins, it can extend this vocabulary at runtime (see Relationship to AI Agent Vision).

### Struct-Aware Observation Encoding (D5)

The 64-dimensional observation vector uses **stable dimensional slots** derived from the JSON-LD schema:

| Dims | Semantic Category |
|------|-------------------|
| 0–15 | `@type` (ontology hierarchy embedding) |
| 16–31 | Identity fields (`pluginId`, `owner`, `@id` URN structure) |
| 32–47 | Relational fields (`provides`, `requires`, `references`) |
| 48–55 | Temporal fields (`clock`, `createdAt`, `expiresAt`) |
| 56–63 | Payload hash (content fingerprint; v2 upgrade: Transformers.js embedding) |

Two nodes of different types that share the same semantic role encode that field in the same slot. This enables **cross-type relational learning** without explicit type engineering.

Slot assignments are auto-generated from `schemas/sovereign-graph.jsonld` at build time. The `ObsEncoder` interface is injectable — swapping the payload slot (56–63) requires no changes to TEM core.

---

## WIT Interfaces Required

The `wit/tem.wit` file defines the complete plugin contract. Key interfaces:

```wit
package refarm:tem@0.1.0;

record tem-output {
  p-inferred:            list<float32>,   // observation-grounded place cells [sumP=120]
  p-recalled:            list<float32>,   // recalled from Hebbian memory [sumP=120]
  novelty-score:         float32,         // L2 prediction error; lower = familiar
  prediction-confidence: float32,         // cosine(p-recalled, p-generated)
}

interface tem-api {
  step:         func(action-id: u32, obs-vec: list<float32>) -> result<tem-output, string>;
  recall:       func(location-hint: list<float32>) -> result<list<float32>, string>;
  reset-walk:   func();
  last-novelty: func() -> float32;
}

interface codegen-api {
  validate-bundle:     func(bundle-json: string) -> result<string, string>;
  generate-weights-ts: func(bundle-json: string) -> result<string, string>;
}

world tem-plugin {
  import refarm:plugin/tractor-bridge@0.1.0;
  export refarm:plugin/integration@0.1.0;
  export tem-api;
  export codegen-api;
}
```

**`tem-api`** is the real-time inference interface — called once per `TelemetryEvent`.

**`codegen-api`** is the plugin-first codegen interface. Any tool callable at runtime exposes a WIT interface; the CLI in `src/codegen/index.ts` is a thin wrapper over this same core. This lets Refarm OS orchestrate weight export without spawning external processes.

---

## How the Tractor Host Loads and Feeds the TEM

### Plugin Manifest (`plugin.json`)

The TEM plugin declares its preferred execution context:

```json
{
  "id": "refarm:tem",
  "executionContext": {
    "preferred": "worker",
    "fallback": "main-thread",
    "allowed": ["worker", "main-thread", "service-worker"]
  },
  "capabilities": {
    "provides": ["TemMemory", "NoveltyScore"],
    "providesApi": ["TemApi", "CodegenApi"]
  },
  "permissions": ["observe:telemetry", "store:TemMemory", "store:NoveltyScore"]
}
```

### Loading Sequence

1. Tractor reads `plugin.json` and sees `executionContext.preferred = "worker"`
2. `resolveRunner()` in `packages/tractor/src/lib/plugin-host.ts` selects `WorkerRunner`
3. `WorkerRunner` instantiates the plugin WASM inside a dedicated `Worker` thread via Comlink
4. If `Worker` is unavailable (e.g., iOS Safari restricted contexts), `WorkerRunner` falls back transparently to `MainThreadRunner`
5. The Comlink proxy exposes `TemApi` calls to the main thread without blocking it

### Per-Step Call Pattern

On each `TelemetryEvent`, the host calls:

```typescript
const output = await tem.step(actionId, obsVec);
// output: { noveltyScore, predictionConfidence, pInferred, pRecalled }

if (output.noveltyScore > NOVELTY_THRESHOLD) {
  await tem.storeNoveltyNode(output);  // persists refarm:TemMemory to Sovereign Graph
}
```

`storeNoveltyNode()` is wired to the Tractor bridge — it writes a `refarm:TemMemory` node into the Sovereign Graph via the `tractor-bridge` WIT import. This makes novelty events durable and queryable by the AI Agent.

### Session Boundaries

Call `reset-walk()` at:
- New plugin load
- Session start
- Significant context switch (e.g., user switches active project)

This resets the G-stream walk position without clearing the Hebbian memory matrix — TEM retains long-term relational knowledge across sessions while starting fresh path integration for each new walk.

---

## Relationship to AI Agent Vision

From [`docs/proposals/SYNERGY_AI_AGENT_TEM.md`](../../../docs/proposals/SYNERGY_AI_AGENT_TEM.md):

> "The TEM is the map; the Agent is the navigator. Without the map, the Agent is lost; without the Agent, the map is merely static territory."

### TEM as Hippocampus

LLMs excel at symbolic manipulation but lack structured long-term memory over a specific user's topology. TEM fills this gap: it continuously maps the relational structure of how the user's Sovereign Graph is traversed, building a persistent episodic memory that survives across sessions.

### Novelty as Active Inference Signal

The Refarm OS operates under Active Inference (see `AGENTS.md`). TEM provides the mathematical metric for this framework:

- **Low `noveltyScore`**: the current graph traversal matches established patterns — the Agent can act with high confidence
- **High `noveltyScore`**: the system is in unfamiliar territory — the Agent should proceed cautiously, gather more information, or surface the novelty to the user

When the Agent proposes creating a new interface or plugin, it queries TEM to determine whether the proposed action fits the user's existing "mental map" or represents genuine structural novelty.

### Dynamic Vocabulary Extension

The current action vocabulary is 16 entries. When the Sovereign Agent creates new plugins, it can extend this vocabulary at runtime. This creates a feedback loop: the Agent creates the tool, TEM learns to recognize it as part of the system's normal topology, and the `noveltyScore` for that new tool decreases as it becomes familiar. The Agent can also trigger TEM retraining when it detects significant structural changes in user interaction patterns.

### WIT Primitives for the Agent

The `noveltyScore` and `predictionConfidence` scalars are exposed as first-class WIT primitives so any component in the Refarm OS can consume them — not just the AI Agent. This is the "Inference Bridge" that makes TEM's internal state observable to the broader system.

---

## Implementation Roadmap (Blueprint)

### Phase 1 — Trained Weights (Prerequisite)

The TypeScript core runs with `createRandomWeights()` (structurally correct, semantically empty). Real inference requires trained weights from the two-stage pipeline:

```
torch_tem checkpoint.pt
  → tools/export_tem_bundle.py   (Python, stdlib only)
  → bundle.json                  (WeightsBundle schema)
  → npx tem-codegen
  → src/core/generated/weights.ts  (Float32Array literals, tree-shakeable)
```

See `TRAINING.md` for the complete guide. The 4 `it.todo` tests in `src/tem.integration.test.ts` activate automatically once trained weights are integrated.

### Phase 2 — WASM Compilation

1. Configure `wasm-pack` or `jco` to compile the TypeScript plugin to WASM
2. Wire `src/plugin.ts` to implement the WIT exports (`tem-api`, `codegen-api`) backed by the existing TypeScript core in `src/core/`
3. Verify the compiled WASM against the WIT contract using `jco wit`
4. Benchmark: confirm ~160k FLOPs / ~1ms per step is maintained in WASM

### Phase 3 — Tractor Host Integration

1. Implement `resolveRunner()` logic in `packages/tractor/src/lib/plugin-host.ts` to read `executionContext` from `plugin.json`
2. Verify `WorkerRunner` loads the TEM WASM inside a Worker thread via Comlink
3. Verify `MainThreadRunner` fallback activates when `Worker` is unavailable
4. Implement the `observe:telemetry` permission: Tractor routes `TelemetryEvent` streams to the TEM plugin automatically

### Phase 4 — Agent Integration

1. Expose `noveltyScore` and `predictionConfidence` as queryable WIT primitives accessible to the AI Agent
2. Implement the Agent-side logic to consult TEM before proposing structural graph changes
3. Implement `reset-walk()` invocation at session boundaries
4. (v2) Replace dims 56–63 in `ObsEncoder` with Transformers.js semantic embeddings — the slot structure ensures backward compatibility

### Out of Scope (current iteration)

- Transformers.js payload embedding (v2; `ObsEncoder` interface enables it without TEM core changes)
- ServiceWorker, Node, and Edge runners (architecture supports; implement after Worker runner is proven)
- CRDT sync of Hebbian memory across devices (requires `SyncAdapter` extension)

---

## References

- Whittington, J.C.R. et al. (2020). The Tolman-Eichenbaum Machine. *Cell* 183(7). DOI: [10.1016/j.cell.2020.10.024](https://doi.org/10.1016/j.cell.2020.10.024)
- torch_tem reference implementation: https://github.com/jbakermans/torch_tem
- Design specification: [`docs/research/tem-sovereign-graph-design.md`](../../../docs/research/tem-sovereign-graph-design.md)
- Agent synergy proposal: [`docs/proposals/SYNERGY_AI_AGENT_TEM.md`](../../../docs/proposals/SYNERGY_AI_AGENT_TEM.md)
- Weight training guide: [`packages/plugin-tem/TRAINING.md`](../TRAINING.md)
- Codegen guide: [`packages/plugin-tem/CODEGEN.md`](../CODEGEN.md)
