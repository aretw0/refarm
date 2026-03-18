# TEM Codegen — Guia End-to-End

Converte um checkpoint PyTorch (`torch_tem`) em pesos TypeScript embebidos no plugin.

## Pipeline two-stage

```text
torch_tem checkpoint.pt
  → (Stage 1) tools/export_tem_bundle.py
  → bundle.json          (WeightsBundle schema)
  → (Stage 2) npx tem-codegen
  → src/core/generated/weights.ts   (Float32Array literals)
```

Depois de gerar `weights.ts`, os 4 testes `it.todo` no suite de integração se
tornam testes ativos e passam com pesos treinados.

---

## Pré-requisitos

- Python ≥ 3.10, PyTorch ≥ 2.0, NumPy
- `torch_tem` clonado localmente: https://github.com/jbakermans/torch_tem

---

## Stage 1 — Exportar do checkpoint

```bash
python tools/export_tem_bundle.py \
  --checkpoint /path/to/torch_tem/checkpoints/tem_v1.pt \
  --out packages/plugin-tem/src/core/generated/bundle.json
```

Para testar sem checkpoint (gera zeros com shapes corretos):

```bash
python tools/export_tem_bundle.py \
  --synthetic \
  --out packages/plugin-tem/src/core/generated/bundle.json
```

---

## Stage 2 — Gerar TypeScript

```bash
npx tem-codegen \
  --weights packages/plugin-tem/src/core/generated/bundle.json \
  --out packages/plugin-tem/src/core/generated/weights.ts
```

---

## Stage 3 — Importar no plugin

```typescript
import { TEM_WEIGHTS_BUNDLE } from "./generated/weights";
import { loadWeightsFromBundle } from "./weights";

const weights = loadWeightsFromBundle(TEM_WEIGHTS_BUNDLE);
const tem = new TEMInference(config, weights);
```

---

## Uso via API de plugin (runtime)

Outro plugin pode solicitar a geração de pesos em runtime:

```typescript
const codegen = await tractor.findByApi("CodegenApi");

// Validar um bundle antes de processar
const validation = await codegen.validateBundle(bundleJson);
if (validation.tag === "err") throw new Error(validation.val);

// Gerar o TypeScript
const generated = await codegen.generateWeightsTs(bundleJson);
if (generated.tag === "ok") {
  // generated.val é o source TypeScript completo
}
```

---

## WeightsBundle — Schema JSON

```typescript
interface WeightsBundle {
  version: string;          // e.g. "0.1.0"
  sourceCommit?: string;    // commit hash do torch_tem
  config: {
    nG: number[];           // e.g. [10, 10, 8, 6, 6]
    nX: number;             // e.g. 64
    nActions: number;       // e.g. 16
  };
  weights: {
    rnn: Array<Array<{      // [nActions][nModules]
      W_ih: number[];       // shape [hidden × input] flattened
      W_hh: number[];       // shape [hidden × hidden] flattened
      b_ih: number[];       // shape [hidden]
      b_hh: number[];       // shape [hidden]
      hiddenSize: number;
      inputSize: number;
    }>>;
    conjunction: {
      W_tile: number[];     // shape [sumP × sumG]
      W_repeat: number[];   // shape [sumP × nX]
    };
    placeGenerator: Array<{ W: number[]; b: number[]; inFeatures: number; outFeatures: number }>;
    sensoryDecoder: Array<{ W: number[]; b: number[]; inFeatures: number; outFeatures: number }>;
  };
}
```

Para a config padrão `nG=[10,10,8,6,6]`, `nX=64`, `nActions=16`:

- `sumG = 40`, `sumP = 120`
- `W_tile`: 4800 elementos, `W_repeat`: 7680 elementos
- Hebbian matrix `M`: 120×120 = 14.400 entradas (mantida em runtime, não no bundle)

---

## Artefatos gerados

`src/core/generated/` está no `.gitignore` — não commitar esses arquivos.
Cada desenvolvedor gera localmente a partir do checkpoint.
