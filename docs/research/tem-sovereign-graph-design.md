# TEM Sovereign Graph — Design Specification
**Date:** 2026-03-17
**Status:** Approved
**Authors:** Collaborative brainstorming session (user + Claude)

---

## 1. Problem Statement

The Refarm OS is a local-first operating system built around a **Sovereign Graph** — a JSON-LD
graph of resources, permissions, and user interactions. As the system grows, it needs a
reasoning engine capable of:

1. Learning the **relational topology** of the graph without centralized training
2. Predicting what resources/capabilities are likely to appear together
3. Detecting **novelty** — flagging when a pattern hasn't been seen before
4. Doing all of the above **in-browser, in real-time, without backpropagation**

At the same time, the current plugin architecture has a gap: a plugin's `manifest.targets`
declares what environments it can run in (browser, server, remote) but cannot declare
**execution context** — whether it should run on the main thread, in a WebWorker,
ServiceWorker, or edge runtime. This limits performance and portability.

---

## 2. Solution Overview

We adapt the **Tolman-Eichenbaum Machine** (TEM, Whittington et al. 2020) as a reasoning
engine for the Sovereign Graph, deployed as a WASM plugin running in a WebWorker — and
simultaneously extend the plugin architecture to formally support arbitrary execution contexts.

The TEM is chosen because it uniquely separates:
- **Structural knowledge** (grid cells `g`) — the topology of who connects to whom
- **Sensory content** (place cells `p`) — what data appears at each node

This mirrors exactly what the Sovereign Graph needs: learning that "after a `storeNode`
of type `PluginManifest`, a `queryNodes` of type `PluginTrustGrant` often follows" is
structural knowledge — independent of the actual plugin content.

---

## 3. TEM Architecture (from torch_tem)

Source: https://github.com/jbakermans/torch_tem
Paper: Whittington et al. (2020), Cell 183(7)

### Three Streams

#### G-stream: Abstract Location (Grid Cells / MEC)
- Tracks **where in the graph** the agent is, independent of what data is there
- Updated by **path integration**: `g_t[f] = RNN(g_{t-1}[f], action_t)` per frequency module
- Multi-frequency factorization: 5 modules with `n_g = [10, 10, 8, 6, 6]` neurons each
- Emergent: grid cells, band cells, border cells arise at different frequencies

#### X-stream: Sensory Input
- The actual observation: what the agent perceives at the current node
- In our context: a struct-aware embedding of the `SovereignNode` and `TelemetryEvent`

#### P-stream: Grounded Location (Place Cells / Hippocampus)
- **Binds** abstract location (g) with sensory content (x)
- `n_p[f] = 3 × n_g[f]` neurons per module (tripling for conjunction)
- `sumP = 120` total place cell neurons → 120×120 Hebbian memory matrix

### Hebbian Memory

The core of episodic memory. Updated every step, non-differentiably:

```
M_t = clamp(λ × M_{t-1} + η × (p_inf ⊗ p_inf − p_gen ⊗ p_gen), −1, +1)
```

Where:
- `η = 0.5` — Hebbian learning rate
- `λ = 0.9999` — exponential forgetting (enables rapid learning without catastrophic interference)
- `p_inf` — place cells inferred from current observation (ground truth)
- `p_gen` — place cells predicted from abstract location (before seeing observation)
- The difference is the **prediction error signal**: strengthens associations where inference corrects prediction

### Attractor Retrieval (Pattern Completion)

Retrieves full place-cell patterns from partial cues:

```
h_0 = project(g_t)       // Initialize from abstract location
for i in 0..K:
  h_{i+1} = kappa × h_i + h_i @ M
  h_{i+1} = clip(h_{i+1}, −1, +1)
p_retrieved = h_K
```

K = 10 fixed iterations, kappa = 0.8. Converges to stored patterns in associative memory.

### Inference-Time Compute

~160k FLOPs per step (batch size 1):
- RNN forward: O(40 × 20) ≈ 800 ops
- Conjunction: O(120²) ≈ 14,400 ops
- Attractor (K=10): O(10 × 120²) ≈ 144,000 ops
- Hebbian update: O(120²) ≈ 14,400 ops

Fast enough for browser event-stream latency. Under 1ms per step in V8.

---

## 4. Design Decisions

### D1 — Deployment Model: TEM as WASM Plugin in WebWorker

TEM lives as a WASM plugin (not Tractor core), loaded by Tractor like any other plugin.
It runs in a dedicated WebWorker via `Comlink` for non-blocking inference.

**Why not Tractor core?**
Embedding TEM in Tractor would couple the reasoning engine to the microkernel, making it
harder to upgrade, swap, or disable. The plugin model maintains sovereignty: TEM can be
replaced by any other plugin that implements `TemApi`.

**Why WebWorker?**
The Hebbian update + attractor loop, while fast, should not block the main thread. More
importantly, TEM as a Worker plugin is the **canonical reference implementation** for the
`executionContext` extension described in D2.

### D2 — Plugin executionContext Extension

The `PluginManifest` is extended with:

```typescript
executionContext?: {
  preferred: "main-thread" | "worker" | "service-worker" | "node" | "edge";
  fallback?: ExecutionContextType;   // e.g. "main-thread" for iOS Safari
  allowed: ExecutionContextType[];
}
```

`PluginHost` grows a `PluginRunner` abstraction with two initial implementations:
- `MainThreadRunner` — current JCO-based behavior, used by default
- `WorkerRunner` — Comlink-based, instantiates plugin WASM inside a Worker thread

The `WorkerRunner` handles the fallback automatically: if `Worker` is unavailable (iOS Safari
in some contexts), it falls back to `MainThreadRunner` transparently.

**Why now?**
WebLLM and Transformers.js are on the Refarm roadmap. Both are computationally heavy and
must not block the main thread. Establishing `executionContext` now means those integrations
inherit the pattern without architectural debt.

### D3 — Weights Strategy: Two-Stage Codegen Pipeline

The entire inference stack is **pure TypeScript** — no ONNX, no `ort-web` runtime.
All tensor math (RNN forward, conjunction, Hebbian update, attractor loop) runs in TS.
In CI and unit tests, `createRandomWeights()` provides structurally-correct zero weights.

For production (trained weights), a two-stage pipeline is implemented:

```text
torch_tem checkpoint.pt
  → (Stage 1)  tools/export_tem_bundle.py   [Python, stdlib only for CI]
  → bundle.json                              [WeightsBundle schema]
  → (Stage 2)  npx tem-codegen
  → src/core/generated/weights.ts           [Float32Array literals, tree-shakeable]
```

**WeightsBundle schema** (`packages/plugin-tem/src/core/weights.ts`):

```typescript
interface WeightsBundle {
  version: string;
  sourceCommit?: string;       // commit hash from torch_tem repo
  config: { nG: number[]; nX: number; nActions: number };
  weights: {
    rnn: Array<Array<{         // [nActions][nModules]
      W_ih: number[];          // [hidden × input] flattened
      W_hh: number[];          // [hidden × hidden] flattened
      b_ih: number[];
      b_hh: number[];
      hiddenSize: number;
      inputSize: number;
    }>>;
    conjunction: { W_tile: number[]; W_repeat: number[] };
    placeGenerator: Array<{ W: number[]; b: number[]; inFeatures: number; outFeatures: number }>;
    sensoryDecoder:  Array<{ W: number[]; b: number[]; inFeatures: number; outFeatures: number }>;
  };
}
```

For the default config (`nG=[10,10,8,6,6]`, `nX=64`, `nActions=16`):
`sumG=40`, `sumP=120` → `W_tile`: 4800 floats, `W_repeat`: 7680 floats.

**Plugin-first principle** — `codegen-api` is a first-class WIT interface, not just a CLI:

```text
core (pure functions)  →  src/codegen/plugin.ts (WIT bridge)  →  src/codegen/index.ts (thin CLI)
```

> **Plugin-first**: any tool that must be callable at runtime exposes a WIT interface.
> The CLI is always a thin wrapper over the pure core. This lets Refarm OS orchestrate
> the tool without spawning external processes.

**Why no ONNX?**
ONNX requires ~2MB `ort-web` runtime and makes weight tensors opaque blobs. TypeScript
codegen emits inspectable, tree-shakeable `Float32Array` literals with zero runtime overhead.
When torch_tem v2 is published, one command regenerates the TypeScript. Research and
production stay in sync automatically.

### D4 — Action Space Mapping

TEM actions drive the grid-cell (structural) stream. Each `TelemetryEvent.event` string
maps to a 1-hot integer index:

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
| ... | up to n_actions = 16 |

Actions represent **transitions in the capability graph** — the structural topology that TEM's
grid cells learn to represent.

### D5 — Struct-Aware Observation Encoding

Observations drive the sensory (place-cell) stream. Rather than treating a `SovereignNode` as
an opaque blob, the encoder uses the JSON-LD schema to assign **stable dimensional slots**:

```
dims 0–15:   @type  (ontology hierarchy embedding)
dims 16–31:  identity fields (pluginId, owner, @id URN structure)
dims 32–47:  relational fields (provides, requires, references)
dims 48–55:  temporal fields (clock, createdAt, expiresAt)
dims 56–63:  payload hash (content fingerprint)
```

**Why struct-aware?**
Two nodes of different types that share the same semantic role (e.g., both have `pluginId`)
will encode that field in the same dimensional slot. TEM learns: "whenever dims 16–23 have
this pattern, action 4 is likely next" — regardless of node type. This is **cross-type
relational learning** without explicit type engineering.

**Upgrade path:**
Slot 56–63 (payload hash) is the first candidate for Transformers.js semantic embeddings in v2.
The `ObsEncoder` interface is injectable — swapping the payload slot requires no changes to
TEM core. The slot structure ensures the other 56 dimensions remain compatible.

The slot assignments are auto-generated from `schemas/sovereign-graph.jsonld` at build time,
so adding new property categories to the ontology automatically updates the encoder.

### D6 — TEM Architecture Constants for JS Port

| Parameter | Value | Meaning |
|-----------|-------|---------|
| `n_g` | [10, 10, 8, 6, 6] | Grid cell neurons per frequency module |
| `n_p` | [30, 30, 24, 18, 18] | Place cell neurons (3× conjunction tripling) |
| `sumP` | 120 | Total place cells → 120×120 Hebbian matrix |
| `eta` | 0.5 | Hebbian learning rate |
| `lambda` | 0.9999 | Exponential memory decay per step |
| `kappa` | 0.8 | Attractor damping coefficient |
| `K_attractor` | 10 | Fixed attractor iterations |

---

## 5. Sovereign Graph Mapping

| TEM Concept | Sovereign Graph Analogue |
|-------------|--------------------------|
| Grid cells `g` | Abstract position in capability/resource topology |
| Place cells `p` | "Where in this specific instance" — bound to actual nodes |
| Sensory input `x` | SovereignNode metadata + TelemetryEvent payload |
| Action `a` | API call type + target plugin (graph traversal step) |
| Hebbian memory `M` | Episodic memory: what co-occurs at what locations |
| Attractor retrieval | Pattern completion: "given this action history, expect..." |
| Novelty score | Prediction error: `||x_predicted - x_actual||` |
| Reset walk | New plugin load / session start / context switch |

**What TEM learns:**
After observing the Sovereign Graph, TEM's grid cells develop representations of the
capability topology — which plugins connect to which, which API calls follow which events.
The Hebbian memory encodes which node *contents* appear at which topological positions.
This enables: "If I'm at a `PluginManifest` node and call `plugin:load`, I'll see a
`PluginTrustGrant` node with these identity fields."

---

## 6. Package Structure

```
packages/
  plugin-manifest/src/types.ts         MODIFY: + ExecutionContextType, ExecutionContextConfig
  tractor/src/lib/
    plugin-runner.ts                   CREATE: PluginRunner interface
    main-thread-runner.ts              CREATE: current JCO instantiation extracted
    worker-runner.ts                   CREATE: Comlink WorkerRunner
    plugin-host.ts                     MODIFY: resolveRunner()
  plugin-tem/                          CREATE: new package
    src/core/                          TEM inference engine (TypeScript)
    src/encoding/                      Action + observation encoders
    src/codegen/                       PyTorch → TypeScript codegen CLI
    src/plugin.ts                      WIT bridge
    src/worker.ts                      Comlink bootstrap
    wit/tem.wit                        WIT API contract
    plugin.json                        Manifest
```

---

## 7. WIT API Contract

```wit
package refarm:tem@0.1.0;

record tem-output {
  p-inferred:            list<float32>,   // observation-grounded place cells [sumP]
  p-recalled:            list<float32>,   // recalled from Hebbian memory [sumP]
  novelty-score:         float32,         // L2 prediction error; lower = familiar
  prediction-confidence: float32,         // cosine(p-recalled, p-generated)
}

interface tem-api {
  step:        func(action-id: u32, obs-vec: list<float32>) -> result<tem-output, string>;
  recall:      func(location-hint: list<float32>) -> result<list<float32>, string>;
  reset-walk:  func();
  last-novelty: func() -> float32;
}

interface codegen-api {
  /// Validate WeightsBundle JSON shapes. Returns detected config JSON on success.
  validate-bundle:      func(bundle-json: string) -> result<string, string>;
  /// Generate TypeScript source with embedded Float32Array literals.
  generate-weights-ts:  func(bundle-json: string) -> result<string, string>;
}

world tem-plugin {
  import refarm:plugin/tractor-bridge@0.1.0;
  export refarm:plugin/integration@0.1.0;
  export tem-api;
  export codegen-api;
}
```

---

## 8. Out of Scope (this iteration)

- Pre-training torch_tem on synthetic Refarm graphs (separate Python task)
- Transformers.js payload embedding (v2 upgrade path; ObsEncoder interface enables it)
- ServiceWorker, Node, Edge runners (architecture supports; implement after Worker proven)
- CRDT sync of Hebbian memory across devices (SyncAdapter extension required)
- WorkerRunner + MainThreadRunner concrete implementations (PluginRunner interface exists; runners pending)
- `storeNoveltyNode()` wiring to Tractor bridge (placeholder in `plugin.ts`; not yet persisted to Sovereign Graph)

---

## 9. References

- Whittington et al. (2020). The Tolman-Eichenbaum Machine. *Cell* 183(7). DOI: 10.1016/j.cell.2020.10.024
- torch_tem repository: https://github.com/jbakermans/torch_tem
- Related: Spiking TEM (2025): https://www.biorxiv.org/content/10.1101/2025.10.16.682754v1
- Implementation plan: `/home/vscode/.claude/plans/swirling-launching-clover.md`
