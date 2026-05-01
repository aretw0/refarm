# Farmhand Task Execution Implementation Plan

> **Execução local (sem PR):** usar este arquivo como fonte única de verdade, avançando por milestones com gates explícitos de integridade.

**Goal:** Build `effort-contract-v1` (open capability contract for structured work items), complete `handleFarmhandTask` execution in Farmhand, add `FileTransportAdapter` + HTTP sidecar, and deliver `refarm task run` + `refarm task status` CLI commands.

**Architecture:** `packages/effort-contract-v1` defines pure types + interfaces (Effort, Task, TaskResult, EffortTransportAdapter) following the same pattern as `storage-contract-v1`. `apps/farmhand` gains a task executor (completing the TODO), a file-based transport (watches `~/.refarm/tasks/`), and an HTTP sidecar on port 42001. `apps/refarm` gains the `task` command with `run` and `status` subcommands, selecting transport via `--transport file|http`.

**Tech Stack:** TypeScript ESM, Vitest 4, Commander 14, Node.js `fs.watch`, `http.createServer` (no Express), `crypto.randomUUID()`

---

## File Map

```
packages/effort-contract-v1/
  package.json                                   create
  tsconfig.json                                  create
  tsconfig.build.json                            create
  src/
    types.ts                                     create  ← Effort, Task, TaskResult, EffortResult, adapters
    conformance.ts                               create  ← runEffortV1Conformance()
    index.ts                                     create  ← re-exports

apps/farmhand/
  package.json                                   modify  ← add @refarm.dev/effort-contract-v1 dep
  tsconfig.json                                  modify  ← add src/transports/* to include
  vitest.config.ts                               create  ← vitest config (currently missing)
  src/
    task-executor.ts                             create  ← executeTask(tractor, ...) — CRDT path
    transports/
      file.ts                                    create  ← FileTransportAdapter
      http.ts                                    create  ← HTTP sidecar (createServer)
    index.ts                                     modify  ← complete handleFarmhandTask, wire transports

apps/refarm/
  package.json                                   modify  ← add @refarm.dev/effort-contract-v1 dep
  src/
    commands/task.ts                             create  ← taskCommand (run + status)
  src/program.ts                                 modify  ← addCommand(taskCommand)
  test/
    commands/task.test.ts                        create  ← unit tests
```

---

## Milestones locais (6 etapas)

> Objetivo: permitir avanço incremental com checkpoints claros, sem “marchar cego”.

### Placar de avanço (atualizar durante execução)

- [x] Milestone 1 — Contrato + execução CRDT base
- [x] Milestone 2 — Transportes Farmhand (file + http)
- [x] Milestone 3 — Superfície CLI + governança de resolução TS
- [x] Milestone 4 — Integridade arquitetural e smoke final
- [x] Milestone 5 — Operação confiável (fila, recovery, observabilidade)
- [ ] Milestone 6 — Daily-driver loop (bridge Pi-layer + sessão persistente)

### Milestone 1 — Contrato + execução CRDT base

**Escopo:** Task 1 + Task 2

- Seed do contrato `packages/effort-contract-v1`
- `handleFarmhandTask` deixa de dropar tarefa silenciosamente
- `task-executor.ts` + testes unitários iniciais

**Gate de saída:**

- `npm --prefix packages/effort-contract-v1 run type-check`
- `npx vitest run apps/farmhand/src/task-executor.test.ts`
- `npm --prefix apps/farmhand run type-check`

---

### Milestone 2 — Transportes Farmhand (file + http)

**Escopo:** Task 3 + Task 4 + Task 5

- `FileTransportAdapter` com `submit/query/process/watch`
- `HttpSidecar` em `42001`
- Boot/teardown dos transportes no `apps/farmhand/src/index.ts`

**Gate de saída:**

- `npx vitest run apps/farmhand/src/transports/file.test.ts`
- `npx vitest run apps/farmhand/src/transports/http.test.ts`
- `npm --prefix apps/farmhand test`
- `npm --prefix apps/farmhand run type-check`

---

### Milestone 3 — Superfície CLI + governança de resolução TS

**Escopo:** Task 6 + Task 7

- `refarm task run` / `refarm task status`
- wiring em `apps/refarm/src/program.ts`
- correção do bloqueio do `tsconfig:guard` em `apps/refarm/tsconfig.json`

**Gate de saída:**

- `npx vitest run apps/refarm/test/commands/task.test.ts`
- `npm --prefix apps/refarm test`
- `npm --prefix apps/refarm run type-check`
- `npm run tsconfig:guard`

---

### Milestone 4 — Integridade arquitetural e smoke final

**Escopo:** Task 8 + Task 9 (com julgamento de risco)

- Rodar smoke final dos três alvos
- Tratar vulnerabilidades sem quebrar arquitetura/fluxo
- Documentar exceções aceitas (se houver)

**Gate de saída:**

- `npm --prefix packages/effort-contract-v1 test && npm --prefix packages/effort-contract-v1 run type-check`
- `npm --prefix apps/farmhand test && npm --prefix apps/farmhand run type-check`
- `npm --prefix apps/refarm test && npm --prefix apps/refarm run type-check`
- `npm audit` com resultado limpo **ou** residual explicitamente documentado

---

### Milestone 5 — Operação confiável (fila, recovery, observabilidade)

**Escopo:** pós-plano inicial (desbloqueio operacional)

- `effort-contract-v1` evoluído com status/campos operacionais:
  - `EffortStatus` inclui `cancelled`
  - `TaskResult` inclui `attempts`/`startedAt`
  - `EffortResult` inclui `submittedAt`/`startedAt`/`attemptCount`/`lastUpdatedAt`
  - `EffortLogEntry` + `EffortSummary`
  - métodos opcionais no adapter (`list`, `logs`, `retry`, `cancel`, `summary`)
- `FileTransportAdapter` ganhou:
  - journal NDJSON em `~/.refarm/task-logs/<effortId>.ndjson`
  - fila interna + recovery de `pending`/`in-progress` no startup
  - controle por arquivos em `~/.refarm/task-control` (`*.retry.json`, `*.cancel.json`)
  - retry policy com limite (`maxAttempts`, default 2)
  - estados finais `done/failed/cancelled`
- `HttpSidecar` expandido:
  - `GET /efforts`
  - `GET /efforts/summary`
  - `GET /efforts/:id/logs`
  - `POST /efforts/:id/retry`
  - `POST /efforts/:id/cancel`
- CLI `refarm task` expandida:
  - `task list`
  - `task logs <effortId> [--tail]`
  - `task retry <effortId>`
  - `task cancel <effortId>`
  - `task status --json` com tentativas/idade

**Gate de saída:**

- `npm --prefix packages/effort-contract-v1 run type-check`
- `npm --prefix packages/effort-contract-v1 run build`
- `npm --prefix apps/farmhand run type-check`
- `npm --prefix apps/farmhand test`
- `npm --prefix apps/refarm run type-check`
- `npm --prefix apps/refarm test`

---

### Milestone 6 — Daily-driver loop (bridge Pi-layer + sessão persistente)

**Escopo:** fase de compound pós-task-execution

- [x] Slice 6.1 (atômico): smoke automatizado real CLI ↔ Farmhand (sem mocks)
  - script `scripts/ci/smoke-task-execution-loop.mjs`
  - comando raiz `npm run task:execution:smoke`
  - gate em `.github/workflows/test.yml` condicionado por `run_task_smoke`
- [ ] Slice 6.2 (próximo): contrato mínimo de sessão persistente (retomada de execução, links task/logs, checkpoint local)
- [ ] Slice 6.3 (próximo): ponte Pi-layer plugin (manifesto mínimo + execução via effort queue)

**Gate de saída (Milestone 6):**

- `npm run task:execution:smoke`
- `npm --prefix apps/farmhand test && npm --prefix apps/farmhand run type-check`
- `npm --prefix apps/refarm test && npm --prefix apps/refarm run type-check`

---

## Protocolo de integridade arquitetural (durante a implementação)

Se aparecer “barbaridade”, **não ignorar**. Classificar e agir:

1. **Classe A (para tudo / corrige antes de avançar)**

   - violações de Source Sovereignty (editar `dist/`, artefatos, outputs gerados)
   - dependência cruzada indevida entre apps (ex.: `apps/refarm` importando implementação de `apps/farmhand`)
   - gate estrutural quebrado (`tsconfig:guard`, type-check base)

2. **Classe B (corrigir no milestone corrente ou no próximo, com nota explícita)**

   - duplicação local tolerável com plano de extração
   - fragilidade de teste sem risco imediato de regressão estrutural

3. **Classe C (débito catalogado)**
   - melhorias não-bloqueantes de DX/higiene

**Regra operacional:** sem “varrer para debaixo do tapete”. Se não for corrigir na hora, registrar no próprio milestone com justificativa, risco e ação posterior.

### Registro de integridade (achados em aberto)

- **[Classe A | resolvido no Milestone 3]** `npm run tsconfig:guard` voltou a `OK` após remoção do alias local em `apps/refarm/tsconfig.json`.
- **[Classe B | mitigado no Milestone 4]** Aplicado caminho seguro (sem `--force`) com atualização de lockfile + overrides de segurança (`dompurify`/`postcss`) + alinhamento de peers Astro (`@astrojs/check` e `@refarm.dev/config`). Resultado: `npm audit` caiu de 9 para 6 moderadas.
- **[Classe B | residual aceito/documentado]** Permanecem 4 moderadas, agora concentradas apenas na cadeia `uuid <14` (mermaid-cli/mermaid/zenuml).
  Remediação total sugerida por npm exige ação potencialmente breaking (`npm audit fix --force`, incluindo downgrade em toolchain). Decisão: **não aplicar sem janela específica de hardening**.

---

## Task 1: Scaffold `packages/effort-contract-v1`

**Files:**

- Create: `packages/effort-contract-v1/package.json`
- Create: `packages/effort-contract-v1/tsconfig.json`
- Create: `packages/effort-contract-v1/tsconfig.build.json`
- Create: `packages/effort-contract-v1/src/types.ts`
- Create: `packages/effort-contract-v1/src/conformance.ts`
- Create: `packages/effort-contract-v1/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@refarm.dev/effort-contract-v1",
  "version": "0.1.0",
  "description": "Versioned effort capability contract (effort:v1) — open, platform-neutral interface for structured work items",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc --project tsconfig.build.json",
    "dev": "tsc --project tsconfig.build.json --watch",
    "lint": "tsc --noEmit",
    "type-check": "tsc --noEmit",
    "test": "vitest run --passWithNoTests",
    "clean": "rm -rf dist"
  },
  "keywords": ["effort", "task", "capability", "contract", "conformance"],
  "author": "Refarm Contributors",
  "license": "AGPL-3.0-only",
  "repository": {
    "type": "git",
    "url": "https://github.com/aretw0/refarm.git",
    "directory": "packages/effort-contract-v1"
  },
  "files": ["dist", "README.md"],
  "publishConfig": { "access": "public" },
  "devDependencies": {
    "@refarm.dev/tsconfig": "*",
    "vitest": "^4.1.4"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "@refarm.dev/tsconfig/node.json",
  "compilerOptions": {
    "noEmit": true,
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create tsconfig.build.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["test/**/*"]
}
```

- [ ] **Step 4: Create src/types.ts**

```typescript
export const EFFORT_CAPABILITY = "effort:v1" as const;

export interface Task {
  id: string;
  pluginId: string;
  fn: string;
  args?: unknown;
}

export interface Effort {
  id: string;
  direction: string; // free-form "why" — user-owned, platform-translated
  tasks: Task[];
  source?: string; // "refarm-cli" | "github-issue" | "linear" | ...
  context?: unknown; // opaque platform metadata — preserved, never interpreted
  submittedAt: string;
}

export interface TaskResult {
  taskId: string;
  effortId: string;
  status: "ok" | "error";
  result?: unknown;
  error?: string;
  completedAt: string;
}

export interface EffortResult {
  effortId: string;
  status: "pending" | "in-progress" | "done" | "failed";
  results: TaskResult[];
  completedAt?: string;
}

// Any platform that produces efforts (GitHub Issues adapter, Linear, CLI, etc.)
export interface EffortSourceAdapter {
  submit(effort: Effort): Promise<string>; // returns effortId
}

// Transport: extends source with observability (File, HTTP, CRDT)
export interface EffortTransportAdapter extends EffortSourceAdapter {
  query(effortId: string): Promise<EffortResult | null>;
  subscribe?(fn: (result: EffortResult) => void): () => void;
}
```

- [ ] **Step 5: Create src/conformance.ts**

```typescript
import {
  EFFORT_CAPABILITY,
  type EffortTransportAdapter,
  type Effort,
} from "./types.js";

export interface EffortConformanceResult {
  pass: boolean;
  total: number;
  failed: number;
  failures: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function runEffortV1Conformance(
  adapter: EffortTransportAdapter
): Promise<EffortConformanceResult> {
  const failures: string[] = [];

  const effort: Effort = {
    id: `conformance-${Date.now()}`,
    direction: "Conformance test effort",
    tasks: [
      {
        id: `task-${Date.now()}`,
        pluginId: "test-plugin",
        fn: "noop",
        args: {},
      },
    ],
    source: "conformance",
    submittedAt: nowIso(),
  };

  let effortId: string | undefined;

  try {
    effortId = await adapter.submit(effort);
    if (!effortId) failures.push("submit() returned empty effortId");
  } catch (e) {
    failures.push(`submit() threw: ${String(e)}`);
  }

  if (effortId) {
    // Allow adapter up to 100ms to process synchronously (file/in-memory adapters)
    await new Promise((r) => setTimeout(r, 100));

    try {
      const result = await adapter.query(effortId);
      if (result === null) {
        // Acceptable: adapter may be async — just verify no error
      } else {
        if (result.effortId !== effortId)
          failures.push("query() returned wrong effortId");
        if (
          !["pending", "in-progress", "done", "failed"].includes(result.status)
        )
          failures.push(`query() returned invalid status: ${result.status}`);
      }
    } catch (e) {
      failures.push(`query() threw: ${String(e)}`);
    }
  }

  const failed = failures.length;
  return { pass: failed === 0, total: 3, failed, failures };
}
```

- [ ] **Step 6: Create src/index.ts**

```typescript
export { EFFORT_CAPABILITY, runEffortV1Conformance } from "./conformance.js";
export type {
  Task,
  Effort,
  TaskResult,
  EffortResult,
  EffortSourceAdapter,
  EffortTransportAdapter,
  EffortConformanceResult,
} from "./types.js";
```

Wait — `EFFORT_CAPABILITY` is in `types.ts`. Fix index.ts:

```typescript
export { runEffortV1Conformance } from "./conformance.js";
export type { EffortConformanceResult } from "./conformance.js";
export { EFFORT_CAPABILITY } from "./types.js";
export type {
  Task,
  Effort,
  TaskResult,
  EffortResult,
  EffortSourceAdapter,
  EffortTransportAdapter,
} from "./types.js";
```

- [ ] **Step 7: Verify type-check passes**

```bash
cd packages/effort-contract-v1
npm install
npm run type-check
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/effort-contract-v1/
git commit -m "feat(effort-contract-v1): scaffold open effort capability contract"
```

---

## Task 2: Complete `handleFarmhandTask` — CRDT execution path

**Files:**

- Create: `apps/farmhand/src/task-executor.ts`
- Modify: `apps/farmhand/src/index.ts` (lines 102–126 — fill in the TODO body)

**Context:** `apps/farmhand/src/index.ts:102–126` has `handleFarmhandTask` with a stub body. The `Tractor` instance has `tractor.plugins.get(pluginId)` → `PluginInstance | undefined` and `instance.call(fn, args)` → `Promise<unknown>`. Task results are written back via `tractor.storeNode()`.

- [ ] **Step 1: Write the failing test**

Create `apps/farmhand/src/task-executor.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { executeTask } from "./task-executor.js";

const makeInstance = (callResult: unknown = { ok: true }) => ({
  call: vi.fn().mockResolvedValue(callResult),
});

const makeTractor = (instance?: ReturnType<typeof makeInstance>) => ({
  plugins: { get: vi.fn().mockReturnValue(instance) },
  storeNode: vi.fn().mockResolvedValue(undefined),
});

describe("executeTask", () => {
  it("calls instance.call with fn and args, writes ok result", async () => {
    const inst = makeInstance({ value: 42 });
    const tractor = makeTractor(inst);

    await executeTask(tractor as any, {
      taskId: "t1",
      effortId: "e1",
      pluginId: "my-plugin",
      fn: "process",
      args: { x: 1 },
    });

    expect(inst.call).toHaveBeenCalledWith("process", { x: 1 });
    expect(tractor.storeNode).toHaveBeenCalledWith(
      expect.objectContaining({
        "@type": "FarmhandTaskResult",
        "task:status": "ok",
        "task:result": JSON.stringify({ value: 42 }),
      })
    );
  });

  it("writes error result when plugin is not loaded", async () => {
    const tractor = makeTractor(undefined);

    await executeTask(tractor as any, {
      taskId: "t2",
      effortId: "e2",
      pluginId: "missing-plugin",
      fn: "run",
      args: undefined,
    });

    expect(tractor.storeNode).toHaveBeenCalledWith(
      expect.objectContaining({
        "task:status": "error",
        "task:error": expect.stringContaining("missing-plugin"),
      })
    );
  });

  it("writes error result when instance.call throws", async () => {
    const inst = { call: vi.fn().mockRejectedValue(new Error("boom")) };
    const tractor = makeTractor(inst as any);

    await executeTask(tractor as any, {
      taskId: "t3",
      effortId: "e3",
      pluginId: "p",
      fn: "f",
      args: null,
    });

    expect(tractor.storeNode).toHaveBeenCalledWith(
      expect.objectContaining({
        "task:status": "error",
        "task:error": "boom",
      })
    );
  });
});
```

- [ ] **Step 2: Add vitest.config.ts to apps/farmhand (needed to run tests)**

Farmhand has no `vitest.config.ts`. Add one:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

Save as `apps/farmhand/vitest.config.ts`.

- [ ] **Step 3: Run the test to confirm it fails**

```bash
cd apps/farmhand
npx vitest run src/task-executor.test.ts
```

Expected: FAIL — `executeTask is not a function` (module not found).

- [ ] **Step 4: Create apps/farmhand/src/task-executor.ts**

```typescript
import type { Tractor } from "@refarm.dev/tractor";

const FARMHAND_PLUGIN_ID = "farmhand";

export interface TaskExecutorInput {
  taskId: string;
  effortId: string;
  pluginId: string;
  fn: string;
  args: unknown;
}

export async function executeTask(
  tractor: Pick<Tractor, "plugins" | "storeNode">,
  { taskId, effortId, pluginId, fn, args }: TaskExecutorInput
): Promise<void> {
  const resultId = `urn:farmhand:task:result:${taskId}`;
  const base = {
    "@context": "https://schema.refarm.dev/",
    "@type": "FarmhandTaskResult",
    "@id": resultId,
    "refarm:sourcePlugin": FARMHAND_PLUGIN_ID,
    "task:resultFor": taskId,
    "task:effortId": effortId,
  };

  const instance = tractor.plugins.get(pluginId);
  if (!instance) {
    await tractor.storeNode({
      ...base,
      "task:status": "error",
      "task:error": `Plugin "${pluginId}" is not loaded on this Farmhand`,
    });
    return;
  }

  try {
    const result = await instance.call(fn, args);
    await tractor.storeNode({
      ...base,
      "task:status": "ok",
      "task:result": JSON.stringify(result),
    });
  } catch (e: any) {
    await tractor.storeNode({
      ...base,
      "task:status": "error",
      "task:error": e.message ?? String(e),
    });
  }
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd apps/farmhand
npx vitest run src/task-executor.test.ts
```

Expected: 3/3 PASS.

- [ ] **Step 6: Wire executeTask into handleFarmhandTask in apps/farmhand/src/index.ts**

Replace the body of `handleFarmhandTask` (lines 102–126). The current code handles the "plugin not found" case but drops the TODO for execution. Replace the entire function:

```typescript
import { executeTask } from "./task-executor.js";

async function handleFarmhandTask(
  tractor: Tractor,
  node: Record<string, unknown>
): Promise<void> {
  const assignedTo = node["task:assignedTo"] as string | undefined;
  if (assignedTo && assignedTo !== FARMHAND_ID) return;

  await executeTask(tractor, {
    taskId: node["@id"] as string,
    effortId:
      (node["task:effortId"] as string | undefined) ?? (node["@id"] as string),
    pluginId: node["task:pluginId"] as string,
    fn: node["task:function"] as string,
    args: node["task:args"],
  });
}
```

- [ ] **Step 7: Run all farmhand tests**

```bash
cd apps/farmhand
npx vitest run
```

Expected: all pass (transport tests + task-executor tests).

- [ ] **Step 8: Commit**

```bash
git add apps/farmhand/
git commit -m "feat(farmhand): complete handleFarmhandTask execution via task-executor"
```

---

## Task 3: `FileTransportAdapter` in apps/farmhand

**Files:**

- Create: `apps/farmhand/src/transports/file.ts`

**Context:** Watches `~/.refarm/tasks/` for new `<effortId>.json` files, each containing an `Effort`. Processes each task via `executeTask` (but without Tractor — the file transport executes tasks independently via a mock executor callback). Writes `EffortResult` to `~/.refarm/task-results/<effortId>.json`. The CLI reads from that file for `task status`.

The `FileTransportAdapter` does NOT boot a Tractor — it receives an `executor` callback injected at construction time. In `apps/farmhand/src/index.ts`, the executor wraps `executeTask(tractor, ...)`. This keeps the transport testable in isolation.

- [ ] **Step 1: Write the failing test**

Create `apps/farmhand/src/transports/file.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { FileTransportAdapter } from "./file.js";
import type { Effort, TaskResult } from "@refarm.dev/effort-contract-v1";

const TEST_BASE = path.join(os.tmpdir(), `refarm-test-${Date.now()}`);

function makeEffort(overrides: Partial<Effort> = {}): Effort {
  return {
    id: "e1",
    direction: "Test effort",
    tasks: [{ id: "t1", pluginId: "p", fn: "f", args: {} }],
    source: "test",
    submittedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("FileTransportAdapter", () => {
  let adapter: FileTransportAdapter;
  let executor: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    executor = vi
      .fn()
      .mockResolvedValue({ status: "ok", result: 42 } as Partial<TaskResult>);
    adapter = new FileTransportAdapter(TEST_BASE, executor);
  });

  afterEach(() => {
    fs.rmSync(TEST_BASE, { recursive: true, force: true });
  });

  it("submit() writes effort file to tasksDir", async () => {
    const effort = makeEffort();
    await adapter.submit(effort);

    const taskFile = path.join(TEST_BASE, "tasks", `${effort.id}.json`);
    expect(fs.existsSync(taskFile)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(taskFile, "utf-8"));
    expect(parsed.id).toBe("e1");
  });

  it("query() returns null for unknown effortId", async () => {
    const result = await adapter.query("unknown-id");
    expect(result).toBeNull();
  });

  it("query() returns EffortResult after process() writes result", async () => {
    const effort = makeEffort();
    await adapter.process(effort);

    const result = await adapter.query("e1");
    expect(result).not.toBeNull();
    expect(result!.effortId).toBe("e1");
    expect(result!.status).toBe("done");
    expect(result!.results).toHaveLength(1);
    expect(result!.results[0].status).toBe("ok");
  });

  it("process() calls executor for each task", async () => {
    const effort = makeEffort({
      tasks: [
        { id: "t1", pluginId: "p", fn: "f", args: {} },
        { id: "t2", pluginId: "p", fn: "g", args: {} },
      ],
    });
    await adapter.process(effort);
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it("process() marks EffortResult as failed when executor throws", async () => {
    executor.mockRejectedValueOnce(new Error("kaboom"));
    const effort = makeEffort();
    await adapter.process(effort);

    const result = await adapter.query("e1");
    expect(result!.results[0].status).toBe("error");
    expect(result!.results[0].error).toBe("kaboom");
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd apps/farmhand
npx vitest run src/transports/file.test.ts
```

Expected: FAIL — `FileTransportAdapter is not a function`.

- [ ] **Step 3: Create apps/farmhand/src/transports/file.ts**

```typescript
import fs from "node:fs";
import path from "node:path";
import type {
  Effort,
  EffortResult,
  EffortTransportAdapter,
  Task,
  TaskResult,
} from "@refarm.dev/effort-contract-v1";

export type TaskExecutorFn = (
  task: Task,
  effortId: string
) => Promise<{ status: "ok" | "error"; result?: unknown; error?: string }>;

export class FileTransportAdapter implements EffortTransportAdapter {
  private readonly tasksDir: string;
  private readonly resultsDir: string;

  constructor(baseDir: string, private readonly executor: TaskExecutorFn) {
    this.tasksDir = path.join(baseDir, "tasks");
    this.resultsDir = path.join(baseDir, "task-results");
    fs.mkdirSync(this.tasksDir, { recursive: true });
    fs.mkdirSync(this.resultsDir, { recursive: true });
  }

  async submit(effort: Effort): Promise<string> {
    const file = path.join(this.tasksDir, `${effort.id}.json`);
    fs.writeFileSync(file, JSON.stringify(effort, null, 2), "utf-8");
    return effort.id;
  }

  async query(effortId: string): Promise<EffortResult | null> {
    const file = path.join(this.resultsDir, `${effortId}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf-8")) as EffortResult;
  }

  /** Process an Effort: execute each Task in order, write EffortResult. */
  async process(effort: Effort): Promise<void> {
    const results: TaskResult[] = [];

    for (const task of effort.tasks) {
      try {
        const out = await this.executor(task, effort.id);
        results.push({
          taskId: task.id,
          effortId: effort.id,
          status: out.status,
          result: out.result,
          error: out.error,
          completedAt: new Date().toISOString(),
        });
      } catch (e: any) {
        results.push({
          taskId: task.id,
          effortId: effort.id,
          status: "error",
          error: e.message ?? String(e),
          completedAt: new Date().toISOString(),
        });
      }
    }

    const allOk = results.every((r) => r.status === "ok");
    const effortResult: EffortResult = {
      effortId: effort.id,
      status: allOk ? "done" : "failed",
      results,
      completedAt: new Date().toISOString(),
    };

    const file = path.join(this.resultsDir, `${effort.id}.json`);
    fs.writeFileSync(file, JSON.stringify(effortResult, null, 2), "utf-8");
  }

  /** Start watching tasksDir for new Effort files. Returns a stop function. */
  watch(): () => void {
    const watcher = fs.watch(this.tasksDir, (event, filename) => {
      if (event !== "rename" || !filename?.endsWith(".json")) return;
      const file = path.join(this.tasksDir, filename);
      if (!fs.existsSync(file)) return;

      let effort: Effort;
      try {
        effort = JSON.parse(fs.readFileSync(file, "utf-8")) as Effort;
      } catch {
        return;
      }

      void this.process(effort);
    });

    return () => watcher.close();
  }
}
```

- [ ] **Step 4: Add `@refarm.dev/effort-contract-v1` to farmhand package.json**

In `apps/farmhand/package.json`, add to `dependencies`:

```json
"@refarm.dev/effort-contract-v1": "*"
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd apps/farmhand
npx vitest run src/transports/file.test.ts
```

Expected: 5/5 PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/farmhand/
git commit -m "feat(farmhand): add FileTransportAdapter for effort:v1"
```

---

## Task 4: HTTP sidecar in apps/farmhand (port 42001)

**Files:**

- Create: `apps/farmhand/src/transports/http.ts`

**Context:** Minimal `http.createServer` (no Express). `POST /efforts` accepts an `Effort` JSON body, calls `adapter.submit()` + schedules `adapter.process()`, returns `{ effortId }`. `GET /efforts/:id` calls `adapter.query()`, returns `EffortResult` or 404. The sidecar delegates all storage to the `FileTransportAdapter` — it has no state of its own.

- [ ] **Step 1: Write the failing test**

Create `apps/farmhand/src/transports/http.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { HttpSidecar } from "./http.js";
import type { EffortResult, Effort } from "@refarm.dev/effort-contract-v1";

function makeAdapter(result: EffortResult | null = null) {
  return {
    submit: vi.fn().mockResolvedValue("e1"),
    query: vi.fn().mockResolvedValue(result),
    process: vi.fn().mockResolvedValue(undefined),
  };
}

async function request(
  port: number,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path,
        headers: payload
          ? {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(payload),
            }
          : {},
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: JSON.parse(data || "null"),
          });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe("HttpSidecar", () => {
  let sidecar: HttpSidecar;
  let adapter: ReturnType<typeof makeAdapter>;
  const PORT = 42099; // use non-conflicting port in tests

  beforeEach(async () => {
    adapter = makeAdapter();
    sidecar = new HttpSidecar(PORT, adapter as any);
    await sidecar.start();
  });

  afterEach(async () => {
    await sidecar.stop();
  });

  it("POST /efforts returns effortId", async () => {
    const effort: Effort = {
      id: "e1",
      direction: "test",
      tasks: [],
      submittedAt: new Date().toISOString(),
    };
    const { status, body } = await request(PORT, "POST", "/efforts", effort);
    expect(status).toBe(200);
    expect((body as any).effortId).toBe("e1");
    expect(adapter.submit).toHaveBeenCalled();
  });

  it("GET /efforts/:id returns EffortResult when found", async () => {
    const mockResult: EffortResult = {
      effortId: "e1",
      status: "done",
      results: [],
      completedAt: new Date().toISOString(),
    };
    adapter.query.mockResolvedValueOnce(mockResult);

    const { status, body } = await request(PORT, "GET", "/efforts/e1");
    expect(status).toBe(200);
    expect((body as any).effortId).toBe("e1");
  });

  it("GET /efforts/:id returns 404 when not found", async () => {
    adapter.query.mockResolvedValueOnce(null);
    const { status } = await request(PORT, "GET", "/efforts/unknown");
    expect(status).toBe(404);
  });

  it("returns 404 for unknown routes", async () => {
    const { status } = await request(PORT, "GET", "/unknown");
    expect(status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd apps/farmhand
npx vitest run src/transports/http.test.ts
```

Expected: FAIL — `HttpSidecar is not a function`.

- [ ] **Step 3: Create apps/farmhand/src/transports/http.ts**

```typescript
import http from "node:http";
import type { EffortResult, Effort } from "@refarm.dev/effort-contract-v1";

export interface SidecarAdapter {
  submit(effort: Effort): Promise<string>;
  query(effortId: string): Promise<EffortResult | null>;
  process(effort: Effort): Promise<void>;
}

export class HttpSidecar {
  private server: http.Server;

  constructor(
    private readonly port: number,
    private readonly adapter: SidecarAdapter
  ) {
    this.server = http.createServer((req, res) => {
      void this.handle(req, res);
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, "127.0.0.1", resolve);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const url = req.url ?? "/";

    try {
      if (req.method === "POST" && url === "/efforts") {
        const effort = await readJson<Effort>(req);
        const effortId = await this.adapter.submit(effort);
        void this.adapter.process(effort);
        json(res, 200, { effortId });
        return;
      }

      const getMatch = url.match(/^\/efforts\/([^/]+)$/);
      if (req.method === "GET" && getMatch) {
        const result = await this.adapter.query(getMatch[1]);
        if (!result) {
          json(res, 404, { error: "not found" });
          return;
        }
        json(res, 200, result);
        return;
      }

      json(res, 404, { error: "not found" });
    } catch (e: any) {
      json(res, 500, { error: e.message });
    }
  }
}

function readJson<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data) as T);
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd apps/farmhand
npx vitest run src/transports/http.test.ts
```

Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/farmhand/src/transports/http.ts apps/farmhand/src/transports/http.test.ts
git commit -m "feat(farmhand): add HTTP sidecar on port 42001 for effort dispatch"
```

---

## Task 5: Wire transports on Farmhand boot

**Files:**

- Modify: `apps/farmhand/src/index.ts`

**Context:** On boot, Farmhand creates a `FileTransportAdapter` with `~/.refarm` as `baseDir`. The executor callback wraps `executeTask(tractor, ...)`. The file watcher is started and stopped on `SIGTERM`/`SIGINT`. The `HttpSidecar` is also started on port 42001. Both transport logs use `[farmhand]` prefix to match existing style.

- [ ] **Step 1: Add imports and transport setup to apps/farmhand/src/index.ts**

At the top of `main()`, after `tractor` is booted and before the `tractor.onNode` calls, add:

```typescript
import os from "node:os";
import path from "node:path";
import {
  FileTransportAdapter,
  type TaskExecutorFn,
} from "./transports/file.js";
import { HttpSidecar } from "./transports/http.js";
import { executeTask } from "./task-executor.js";

// Inside main(), after tractor is booted:

const FARMHAND_BASE = path.join(os.homedir(), ".refarm");

const taskExecutorFn: TaskExecutorFn = async (task, effortId) => {
  // Bridge: call executeTask and translate its storeNode side-effect to a plain result
  let status: "ok" | "error" = "ok";
  let result: unknown;
  let error: string | undefined;

  const captureTractor = {
    plugins: tractor.plugins,
    storeNode: async (node: Record<string, unknown>) => {
      status = node["task:status"] as "ok" | "error";
      result = node["task:result"];
      error = node["task:error"] as string | undefined;
    },
  };

  await executeTask(captureTractor as any, {
    taskId: task.id,
    effortId,
    pluginId: task.pluginId,
    fn: task.fn,
    args: task.args,
  });

  return { status, result, error };
};

const fileTransport = new FileTransportAdapter(FARMHAND_BASE, taskExecutorFn);
const stopFileWatcher = fileTransport.watch();
console.log(`[farmhand] File transport watching ${FARMHAND_BASE}/tasks/`);

const httpSidecar = new HttpSidecar(42001, fileTransport);
await httpSidecar.start();
console.log("[farmhand] HTTP sidecar listening on http://127.0.0.1:42001");
```

- [ ] **Step 2: Add transport teardown to the shutdown function**

Inside the `shutdown()` function in `apps/farmhand/src/index.ts`, before `process.exit(0)`:

```typescript
stopFileWatcher();
await httpSidecar.stop();
```

- [ ] **Step 3: Type-check farmhand**

```bash
cd apps/farmhand
npm run type-check
```

Expected: no errors.

- [ ] **Step 4: Run all farmhand tests**

```bash
cd apps/farmhand
npx vitest run
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/farmhand/src/index.ts
git commit -m "feat(farmhand): wire FileTransportAdapter and HttpSidecar on boot"
```

---

## Task 6: `refarm task` command — `run` and `status`

**Files:**

- Create: `apps/refarm/src/commands/task.ts`
- Create: `apps/refarm/test/commands/task.test.ts`
- Modify: `apps/refarm/src/program.ts`
- Modify: `apps/refarm/package.json` (add effort-contract-v1 dep)

**Context:** `refarm task run <plugin> <fn>` builds an `Effort` with a single `Task`, submits via adapter, prints `effortId`. `refarm task status <effortId>` calls `adapter.query()` and prints results. Transport is `file` by default; `--transport http` uses `HttpTransportAdapter` (a thin wrapper around the sidecar HTTP API). The test mocks the adapter — no file system or network I/O.

- [ ] **Step 1: Write the failing test**

Create `apps/refarm/test/commands/task.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSubmit, mockQuery } = vi.hoisted(() => ({
  mockSubmit: vi.fn().mockResolvedValue("effort-abc"),
  mockQuery: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../src/commands/task.js", async (importOriginal) => {
  const mod = (await importOriginal()) as any;
  return mod;
});

// Mock the adapter factory inside the command
vi.mock("@refarm.dev/effort-contract-v1", async (importOriginal) => {
  return importOriginal();
});

// We'll inject mock adapters via the resolveAdapter export
vi.mock("../../src/commands/task.js", async () => {
  const { Command } = await import("commander");
  const chalk = (await import("chalk")).default;

  const resolveAdapter = () => ({
    submit: mockSubmit,
    query: mockQuery,
  });

  const taskCommand = new Command("task").description(
    "Manage Farmhand task efforts"
  );

  taskCommand
    .command("run <plugin> <fn>")
    .description("Dispatch a task effort to Farmhand")
    .option("--args <json>", "Task args as JSON string", "{}")
    .option(
      "--direction <text>",
      "Effort direction (the why)",
      "Manual CLI dispatch"
    )
    .option("--transport <type>", "Transport: file or http", "file")
    .action(
      async (
        plugin: string,
        fn: string,
        opts: { args: string; direction: string }
      ) => {
        const adapter = resolveAdapter();
        const effortId = await adapter.submit({
          id: crypto.randomUUID(),
          direction: opts.direction,
          tasks: [
            {
              id: crypto.randomUUID(),
              pluginId: plugin,
              fn,
              args: JSON.parse(opts.args),
            },
          ],
          source: "refarm-cli",
          submittedAt: new Date().toISOString(),
        });
        console.log(chalk.green(`Effort dispatched: ${effortId}`));
      }
    );

  taskCommand
    .command("status <effortId>")
    .description("Query the result of a dispatched effort")
    .option("--transport <type>", "Transport: file or http", "file")
    .option("--watch", "Poll until done or failed")
    .action(async (effortId: string) => {
      const adapter = resolveAdapter();
      const result = await adapter.query(effortId);
      if (!result) {
        console.log(chalk.gray("No result yet."));
        return;
      }
      console.log(chalk.bold(`Effort ${effortId}: ${result.status}`));
    });

  return { taskCommand, resolveAdapter };
});

import { taskCommand } from "../../src/commands/task.js";

describe("taskCommand", () => {
  beforeEach(() => vi.clearAllMocks());

  it("run calls adapter.submit and prints effortId", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await taskCommand.commands
      .find((c) => c.name() === "run")!
      .parseAsync(["my-plugin", "process", "--args", '{"x":1}'], {
        from: "user",
      });

    expect(mockSubmit).toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("effort-abc"));
    spy.mockRestore();
  });

  it("status prints 'No result yet' when query returns null", async () => {
    mockQuery.mockResolvedValueOnce(null);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await taskCommand.commands
      .find((c) => c.name() === "status")!
      .parseAsync(["effort-abc"], { from: "user" });

    expect(spy).toHaveBeenCalledWith(expect.stringContaining("No result yet"));
    spy.mockRestore();
  });

  it("status prints effort status when result is found", async () => {
    mockQuery.mockResolvedValueOnce({
      effortId: "effort-abc",
      status: "done",
      results: [],
      completedAt: new Date().toISOString(),
    });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await taskCommand.commands
      .find((c) => c.name() === "status")!
      .parseAsync(["effort-abc"], { from: "user" });

    expect(spy).toHaveBeenCalledWith(expect.stringContaining("done"));
    spy.mockRestore();
  });
});
```

Note: the test mock approach above is complex. Use a simpler approach — test the command actions directly:

Replace the test content with this simpler version:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSubmit, mockQuery } = vi.hoisted(() => ({
  mockSubmit: vi.fn().mockResolvedValue("effort-abc"),
  mockQuery: vi.fn().mockResolvedValue(null),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return { ...actual, default: { ...actual.default } };
});

// Mock resolveAdapter to inject our fakes
vi.mock("../../src/commands/task.js", async (importOriginal) => {
  const mod = (await importOriginal()) as any;
  // Wrap resolveAdapter to return mocks
  const original = mod.resolveAdapter;
  mod.resolveAdapter = vi
    .fn()
    .mockReturnValue({ submit: mockSubmit, query: mockQuery });
  return mod;
});

import { taskCommand } from "../../src/commands/task.js";

describe("taskCommand run", () => {
  beforeEach(() => vi.clearAllMocks());

  it("dispatches effort and prints effortId", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await taskCommand.commands
      .find((c) => c.name() === "run")!
      .parseAsync(["my-plugin", "process", "--direction", "Test"], {
        from: "user",
      });
    expect(mockSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ direction: "Test", source: "refarm-cli" })
    );
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("effort-abc"));
    spy.mockRestore();
  });
});

describe("taskCommand status", () => {
  beforeEach(() => vi.clearAllMocks());

  it("prints 'No result yet' when query returns null", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await taskCommand.commands
      .find((c) => c.name() === "status")!
      .parseAsync(["effort-abc"], { from: "user" });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("No result yet"));
    spy.mockRestore();
  });

  it("prints status when result found", async () => {
    mockQuery.mockResolvedValueOnce({
      effortId: "effort-abc",
      status: "done",
      results: [],
      completedAt: new Date().toISOString(),
    });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await taskCommand.commands
      .find((c) => c.name() === "status")!
      .parseAsync(["effort-abc"], { from: "user" });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("done"));
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd apps/refarm
npx vitest run test/commands/task.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create apps/refarm/src/commands/task.ts**

```typescript
import { Command } from "commander";
import chalk from "chalk";
import os from "node:os";
import path from "node:path";
import { FileTransportAdapter } from "@refarm.dev/farmhand/transports/file";
import type {
  EffortTransportAdapter,
  Effort,
} from "@refarm.dev/effort-contract-v1";

// HttpTransportAdapter — thin HTTP client wrapping the Farmhand sidecar
class HttpTransportAdapter implements EffortTransportAdapter {
  constructor(private readonly baseUrl: string) {}

  async submit(effort: Effort): Promise<string> {
    const res = await fetch(`${this.baseUrl}/efforts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(effort),
    });
    const data = (await res.json()) as { effortId: string };
    return data.effortId;
  }

  async query(effortId: string) {
    const res = await fetch(`${this.baseUrl}/efforts/${effortId}`);
    if (res.status === 404) return null;
    return res.json() as any;
  }
}

export function resolveAdapter(transport: string): EffortTransportAdapter {
  if (transport === "http")
    return new HttpTransportAdapter("http://127.0.0.1:42001");
  const baseDir = path.join(os.homedir(), ".refarm");
  // CLI-side: no executor (read-only for query; submit writes the file for Farmhand to pick up)
  return new FileTransportAdapter(baseDir, async () => ({ status: "ok" }));
}

export const taskCommand = new Command("task").description(
  "Manage Farmhand task efforts"
);

taskCommand
  .command("run <plugin> <fn>")
  .description("Dispatch a task effort to Farmhand")
  .option("--args <json>", "Task args as JSON string", "{}")
  .option(
    "--direction <text>",
    "Effort direction (the why)",
    "Manual CLI dispatch"
  )
  .option("--transport <type>", "Transport adapter: file or http", "file")
  .action(
    async (
      plugin: string,
      fn: string,
      opts: { args: string; direction: string; transport: string }
    ) => {
      const adapter = resolveAdapter(opts.transport);
      let parsedArgs: unknown;
      try {
        parsedArgs = JSON.parse(opts.args);
      } catch {
        console.error(chalk.red("--args must be valid JSON"));
        process.exitCode = 1;
        return;
      }

      const effort: Effort = {
        id: crypto.randomUUID(),
        direction: opts.direction,
        tasks: [
          { id: crypto.randomUUID(), pluginId: plugin, fn, args: parsedArgs },
        ],
        source: "refarm-cli",
        submittedAt: new Date().toISOString(),
      };

      const effortId = await adapter.submit(effort);
      console.log(chalk.green(`Effort dispatched: ${chalk.bold(effortId)}`));
      console.log(
        chalk.gray(
          `  Use: refarm task status ${effortId} --transport ${opts.transport}`
        )
      );
    }
  );

taskCommand
  .command("status <effortId>")
  .description("Query the result of a dispatched effort")
  .option("--transport <type>", "Transport adapter: file or http", "file")
  .option("--watch", "Poll every 2s until done or failed")
  .action(
    async (effortId: string, opts: { transport: string; watch?: boolean }) => {
      const adapter = resolveAdapter(opts.transport);

      const print = async (): Promise<boolean> => {
        const result = await adapter.query(effortId);
        if (!result) {
          console.log(chalk.gray("No result yet."));
          return false;
        }
        const color =
          result.status === "done"
            ? chalk.green
            : result.status === "failed"
            ? chalk.red
            : chalk.yellow;
        console.log(chalk.bold(`Effort ${effortId}: ${color(result.status)}`));
        for (const r of result.results) {
          const s = r.status === "ok" ? chalk.green("ok") : chalk.red("error");
          console.log(
            `  Task ${r.taskId}: ${s}${r.error ? ` — ${r.error}` : ""}`
          );
        }
        return result.status === "done" || result.status === "failed";
      };

      if (!opts.watch) {
        await print();
        return;
      }

      while (true) {
        const done = await print();
        if (done) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  );
```

Note: `FileTransportAdapter` is from `apps/farmhand` which is not a published package. The CLI needs its own copy or the adapter code must be extracted. Since `FileTransportAdapter` depends on `@refarm.dev/effort-contract-v1` only, move the CLI-side adapter into `apps/refarm/src/adapters/`.

**Revised approach — inline adapters in task.ts (no cross-app import):**

The CLI only needs `submit()` and `query()` — not `process()` or `watch()`. Both are simple file I/O operations. Inline them in `task.ts`:

```typescript
import { Command } from "commander";
import chalk from "chalk";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type {
  EffortTransportAdapter,
  Effort,
  EffortResult,
} from "@refarm.dev/effort-contract-v1";

class FileTransportClient implements EffortTransportAdapter {
  private readonly tasksDir: string;
  private readonly resultsDir: string;

  constructor(baseDir: string) {
    this.tasksDir = path.join(baseDir, "tasks");
    this.resultsDir = path.join(baseDir, "task-results");
    fs.mkdirSync(this.tasksDir, { recursive: true });
    fs.mkdirSync(this.resultsDir, { recursive: true });
  }

  async submit(effort: Effort): Promise<string> {
    fs.writeFileSync(
      path.join(this.tasksDir, `${effort.id}.json`),
      JSON.stringify(effort, null, 2),
      "utf-8"
    );
    return effort.id;
  }

  async query(effortId: string): Promise<EffortResult | null> {
    const file = path.join(this.resultsDir, `${effortId}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf-8")) as EffortResult;
  }
}

class HttpTransportClient implements EffortTransportAdapter {
  constructor(private readonly baseUrl: string) {}

  async submit(effort: Effort): Promise<string> {
    const res = await fetch(`${this.baseUrl}/efforts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(effort),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { effortId: string };
    return data.effortId;
  }

  async query(effortId: string): Promise<EffortResult | null> {
    const res = await fetch(`${this.baseUrl}/efforts/${effortId}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<EffortResult>;
  }
}

export function resolveAdapter(transport: string): EffortTransportAdapter {
  if (transport === "http")
    return new HttpTransportClient("http://127.0.0.1:42001");
  return new FileTransportClient(path.join(os.homedir(), ".refarm"));
}

export const taskCommand = new Command("task").description(
  "Manage Farmhand task efforts"
);

taskCommand
  .command("run <plugin> <fn>")
  .description("Dispatch a task effort to Farmhand")
  .option("--args <json>", "Task args as JSON string", "{}")
  .option(
    "--direction <text>",
    "Effort direction (the why)",
    "Manual CLI dispatch"
  )
  .option("--transport <type>", "Transport adapter: file or http", "file")
  .action(
    async (
      plugin: string,
      fn: string,
      opts: { args: string; direction: string; transport: string }
    ) => {
      const adapter = resolveAdapter(opts.transport);
      let parsedArgs: unknown;
      try {
        parsedArgs = JSON.parse(opts.args);
      } catch {
        console.error(chalk.red("--args must be valid JSON"));
        process.exitCode = 1;
        return;
      }

      const effort: Effort = {
        id: crypto.randomUUID(),
        direction: opts.direction,
        tasks: [
          { id: crypto.randomUUID(), pluginId: plugin, fn, args: parsedArgs },
        ],
        source: "refarm-cli",
        submittedAt: new Date().toISOString(),
      };

      const effortId = await adapter.submit(effort);
      console.log(chalk.green(`Effort dispatched: ${chalk.bold(effortId)}`));
      console.log(
        chalk.gray(
          `  Use: refarm task status ${effortId} --transport ${opts.transport}`
        )
      );
    }
  );

taskCommand
  .command("status <effortId>")
  .description("Query the result of a dispatched effort")
  .option("--transport <type>", "Transport adapter: file or http", "file")
  .option("--watch", "Poll every 2s until done or failed")
  .action(
    async (effortId: string, opts: { transport: string; watch?: boolean }) => {
      const adapter = resolveAdapter(opts.transport);

      const print = async (): Promise<boolean> => {
        const result = await adapter.query(effortId);
        if (!result) {
          console.log(chalk.gray("No result yet."));
          return false;
        }
        const color =
          result.status === "done"
            ? chalk.green
            : result.status === "failed"
            ? chalk.red
            : chalk.yellow;
        console.log(chalk.bold(`Effort ${effortId}: ${color(result.status)}`));
        for (const r of result.results) {
          const s = r.status === "ok" ? chalk.green("ok") : chalk.red("error");
          console.log(
            `  Task ${r.taskId}: ${s}${r.error ? ` — ${r.error}` : ""}`
          );
        }
        return result.status === "done" || result.status === "failed";
      };

      if (!opts.watch) {
        await print();
        return;
      }

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const done = await print();
        if (done) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  );
```

- [ ] **Step 4: Update apps/refarm/package.json — add effort-contract-v1 dep**

```json
"@refarm.dev/effort-contract-v1": "*"
```

Add this to the `dependencies` section.

- [ ] **Step 5: Update tests to match the inlined adapter approach**

Replace `apps/refarm/test/commands/task.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSubmit, mockQuery } = vi.hoisted(() => ({
  mockSubmit: vi.fn().mockResolvedValue("effort-abc"),
  mockQuery: vi
    .fn<
      [],
      Promise<import("@refarm.dev/effort-contract-v1").EffortResult | null>
    >()
    .mockResolvedValue(null),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("node:fs");
  return {
    ...actual,
    default: {
      ...actual.default,
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      existsSync: vi.fn().mockReturnValue(false),
      readFileSync: vi.fn(),
    },
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn(),
  };
});

// Patch resolveAdapter to return mock adapter
vi.mock("../../src/commands/task.js", async (importOriginal) => {
  const mod = (await importOriginal()) as any;
  const fakeAdapter = { submit: mockSubmit, query: mockQuery };
  mod.resolveAdapter = vi.fn().mockReturnValue(fakeAdapter);
  return mod;
});

import { taskCommand } from "../../src/commands/task.js";

describe("refarm task run", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls adapter.submit with correct shape and prints effortId", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await taskCommand.commands
      .find((c) => c.name() === "run")!
      .parseAsync(["my-plugin", "process", "--direction", "Test effort"], {
        from: "user",
      });
    expect(mockSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: "Test effort",
        source: "refarm-cli",
      })
    );
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("effort-abc"));
    spy.mockRestore();
  });

  it("prints error and sets exitCode when --args is invalid JSON", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await taskCommand.commands
      .find((c) => c.name() === "run")!
      .parseAsync(["p", "f", "--args", "not-json"], { from: "user" });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("valid JSON"));
    spy.mockRestore();
  });
});

describe("refarm task status", () => {
  beforeEach(() => vi.clearAllMocks());

  it("prints 'No result yet' when query returns null", async () => {
    mockQuery.mockResolvedValueOnce(null);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await taskCommand.commands
      .find((c) => c.name() === "status")!
      .parseAsync(["effort-abc"], { from: "user" });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("No result yet"));
    spy.mockRestore();
  });

  it("prints status and task results when found", async () => {
    mockQuery.mockResolvedValueOnce({
      effortId: "effort-abc",
      status: "done",
      results: [
        {
          taskId: "t1",
          effortId: "effort-abc",
          status: "ok",
          completedAt: new Date().toISOString(),
        },
      ],
      completedAt: new Date().toISOString(),
    });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await taskCommand.commands
      .find((c) => c.name() === "status")!
      .parseAsync(["effort-abc"], { from: "user" });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("done"));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("t1"));
    spy.mockRestore();
  });
});
```

- [ ] **Step 6: Run tests**

```bash
cd apps/refarm
npx vitest run test/commands/task.test.ts
```

Expected: 4/4 PASS.

- [ ] **Step 7: Wire taskCommand into program.ts**

In `apps/refarm/src/program.ts`, add:

```typescript
import { taskCommand } from "./commands/task.js";
// ... existing imports ...

program.addCommand(taskCommand);
```

- [ ] **Step 8: Type-check apps/refarm**

```bash
cd apps/refarm
npm run type-check
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/refarm/src/commands/task.ts apps/refarm/test/commands/task.test.ts apps/refarm/src/program.ts apps/refarm/package.json
git commit -m "feat(refarm): add 'refarm task run' and 'refarm task status' commands"
```

---

## Task 7: Fix pre-push type-check gate

**Context:** The pre-push hook runs a TSConfig guard that rejects path aliases resolving outside a package's own directory. `apps/refarm/tsconfig.json` has:

```json
"paths": { "@refarm.dev/cli/status": ["../../packages/cli/src/status.ts"] }
```

This resolves to `packages/cli/src/status.ts` — outside `apps/refarm/` — and triggers the guard. The fix: build `packages/cli` so its `dist/` is available, then remove the `paths` alias from `apps/refarm/tsconfig.json` and let TypeScript resolve `@refarm.dev/cli/status` via the package's `exports` field in `package.json`.

**Files:**

- Modify: `apps/refarm/tsconfig.json`

- [ ] **Step 1: Build packages/cli**

```bash
cd packages/cli
npm run build
```

Expected: `packages/cli/dist/status.js` and `packages/cli/dist/status.d.ts` are generated.

- [ ] **Step 2: Remove the paths alias from apps/refarm/tsconfig.json**

Current `apps/refarm/tsconfig.json`:

```json
{
  "extends": "@refarm.dev/tsconfig/node.json",
  "compilerOptions": {
    "noEmit": true,
    "paths": {
      "@refarm.dev/cli/status": ["../../packages/cli/src/status.ts"]
    }
  },
  "include": ["src/**/*", "test/**/*"]
}
```

Replace with:

```json
{
  "extends": "@refarm.dev/tsconfig/node.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 3: Type-check apps/refarm**

```bash
cd apps/refarm
npm run type-check
```

Expected: no errors. TypeScript resolves `@refarm.dev/cli/status` via `packages/cli/package.json` exports → `dist/status.d.ts`.

If this fails with "cannot find module @refarm.dev/cli/status", it means `packages/cli` dist is not symlinked. In that case run `npm install` from the root first:

```bash
cd /workspaces/refarm && npm install
cd apps/refarm && npm run type-check
```

- [ ] **Step 4: Commit**

```bash
git add apps/refarm/tsconfig.json packages/cli/dist/
git commit -m "fix(refarm): remove paths alias for @refarm.dev/cli/status — resolve via dist"
```

---

## Task 8: npm audit fix

**Context:** `npm audit` reports 9 moderate vulnerabilities:

- `astro < 6.1.6` → XSS — `npm audit fix`
- `dompurify ≤ 3.3.3` → XSS — `npm audit fix`
- `postcss < 8.5.10` → XSS — `npm audit fix`
- `uuid < 14.0.0` in `@storybook/addon-actions` and `mermaid` — requires `--force`

- [ ] **Step 1: Fix non-breaking vulnerabilities**

```bash
cd /workspaces/refarm
npm audit fix
```

Expected output: "fixed N vulnerabilities". astro, dompurify, postcss should be resolved.

- [ ] **Step 2: Check remaining vulnerabilities**

```bash
npm audit
```

Expected: only the uuid/mermaid-cli chain remains (requires `--force`).

- [ ] **Step 3: Fix uuid vulnerability (breaking change in mermaid-cli)**

The `--force` flag downgrades `@mermaid-js/mermaid-cli` to 10.8.0. Check if this tool is used in CI or scripts before proceeding:

```bash
grep -r "mermaid-cli\|mmdc" /workspaces/refarm/package.json /workspaces/refarm/.github/ 2>/dev/null | head -10
```

If `mermaid-cli` is only a dev tool and the downgrade is acceptable:

```bash
npm audit fix --force
```

If the downgrade would break CI, instead pin `@mermaid-js/mermaid-cli` to a safe version manually in the relevant workspace's `package.json` and run `npm install`.

- [ ] **Step 4: Verify audit is clean (or confirm acceptable residuals)**

```bash
npm audit
```

Expected: 0 vulnerabilities (or documented exceptions if force-fix breaks something).

- [ ] **Step 5: Commit**

```bash
git add package-lock.json
git commit -m "fix: address npm audit vulnerabilities (astro, dompurify, postcss, uuid)"
```

---

## Task 9: Smoke Gate

- [ ] **Step 1: Run all package tests**

```bash
cd /workspaces/refarm
npx turbo run test --filter=@refarm.dev/effort-contract-v1
npx turbo run test --filter=@refarm.dev/farmhand
npx turbo run test --filter=@refarm.dev/refarm
```

Or run from each directory:

```bash
cd packages/effort-contract-v1 && npm test
cd apps/farmhand && npm test
cd apps/refarm && npm test
```

Expected:

- `effort-contract-v1`: conformance tests pass (or passWithNoTests)
- `farmhand`: task-executor (3), file transport (5), http sidecar (4), ws transport (8) — all pass
- `refarm`: all 35+ tests pass (31 existing + 4 new task command tests)

- [ ] **Step 2: Type-check all three**

```bash
cd packages/effort-contract-v1 && npm run type-check
cd apps/farmhand && npm run type-check
cd apps/refarm && npm run type-check
```

Expected: no errors in any.

- [ ] **Step 3: Commit smoke gate**

```bash
git add .
git commit -m "chore: smoke gate passed — farmhand task execution + effort-contract-v1 complete"
```
