# Farmhand Task Execution — Design Doc

**Date:** 2026-05-01
**Status:** Approved
**Feature:** FarmhandTask Execution + effort-contract-v1 + CLI dispatch

---

## Context

`apps/farmhand` has a `handleFarmhandTask` stub that drops tasks silently. The `FarmhandTask`
CRDT node type is the only mechanism today — proprietary, not extensible. This design completes
the execution pipeline and replaces the proprietary type with an open capability contract,
following the same pattern as `storage-contract-v1`, `sync-contract-v1`, `identity-contract-v1`.

---

## Semantic Model

```
Effort (context + direction — the "why", declared by the user)
  └── Task[] (execution units — call plugin.fn(args))
        └── TaskResult (what happened)
```

- **Effort** maps to any structured work item: GitHub Issue, Linear ticket, commit, CLI dispatch.
  The user declares the direction; Refarm doesn't interpret it, only persists it.
- **Task** is the atomic execution unit: call a loaded plugin function with given args.
- **context** on Effort is opaque platform metadata (e.g. `{ issueNumber: 42, repo: "..." }`).
  Farmhand stores it alongside results for traceability but never reads it.

---

## Package Structure

```
packages/effort-contract-v1          (new)
  └── index.ts — pure types + interfaces, zero runtime deps

apps/farmhand                        (modified)
  ├── src/task-executor.ts           — completes handleFarmhandTask
  ├── src/transports/file.ts         — FileTransportAdapter (watches ~/.refarm/tasks/)
  ├── src/transports/http.ts         — HTTP sidecar on port 42001
  └── src/index.ts                   — wires both transports on boot

apps/refarm                          (modified)
  └── src/commands/task.ts           — refarm task run + refarm task status
```

---

## Data Model (`packages/effort-contract-v1`)

```typescript
export interface Task {
  id: string;
  pluginId: string;
  fn: string;
  args?: unknown;
}

export interface Effort {
  id: string;
  direction: string;      // free-form "why" — user-owned
  tasks: Task[];
  source?: string;        // "refarm-cli" | "github-issue" | "linear" | ...
  context?: unknown;      // opaque platform metadata
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

// Any platform that produces efforts (GitHub Issues adapter, Linear adapter, etc.)
export interface EffortSourceAdapter {
  submit(effort: Effort): Promise<string>;
}

// Transport: extends Source with observability (File, HTTP, CRDT)
export interface EffortTransportAdapter extends EffortSourceAdapter {
  query(effortId: string): Promise<EffortResult | null>;
  subscribe?(fn: (result: EffortResult) => void): () => void;
}

export const EFFORT_CAPABILITY = Symbol("EffortTransportAdapter");
```

---

## Farmhand Changes

### Task Executor (`src/task-executor.ts`)

Completes `handleFarmhandTask`:

```typescript
async function executeTask(tractor: Tractor, node: Record<string, unknown>): Promise<void> {
  const taskId   = node["@id"] as string;
  const effortId = (node["task:effortId"] as string | undefined) ?? taskId;
  const pluginId = node["task:pluginId"] as string;
  const fn       = node["task:function"] as string;
  const args     = node["task:args"];

  const instance = tractor.plugins.get(pluginId);
  if (!instance) {
    await writeTaskResult(tractor, { taskId, effortId, status: "error",
      error: `Plugin "${pluginId}" is not loaded`, completedAt: new Date().toISOString() });
    return;
  }

  try {
    const result = await instance.call(fn, args);
    await writeTaskResult(tractor, { taskId, effortId, status: "ok",
      result, completedAt: new Date().toISOString() });
  } catch (e: any) {
    await writeTaskResult(tractor, { taskId, effortId, status: "error",
      error: e.message, completedAt: new Date().toISOString() });
  }
}
```

### FileTransportAdapter (`src/transports/file.ts`)

- Watches `~/.refarm/tasks/` with `fs.watch` for new `<effortId>.json` files
- Parses as `Effort`, calls `executeTask` for each `Task` in order
- **The adapter owns both halves of the file transport:** writes `EffortResult` to
  `~/.refarm/task-results/<effortId>.json` after execution completes
- `submit()`: writes `~/.refarm/tasks/<effortId>.json`
- `query()`: reads from `~/.refarm/task-results/<effortId>.json`

Note: the existing CRDT-based `handleFarmhandTask` path continues to use `tractor.storeNode()`
to write `FarmhandTaskResult` nodes into the graph. The file transport is an independent path —
both can coexist in the same Farmhand process.

### HTTP Sidecar (`src/transports/http.ts`)

Minimal `http.createServer` (no Express) on port 42001:

- `POST /efforts` — body: `Effort` JSON → enqueues for execution → `{ effortId: string }`
- `GET /efforts/:id` — reads `EffortResult` from file store → `EffortResult | 404`

The sidecar is optional: Farmhand boots cleanly without it. File transport is always active.

---

## CLI Changes (`apps/refarm`)

### `refarm task run`

```bash
refarm task run <plugin> <fn> \
  --args '{"input": "hello"}' \
  --direction "Process user input" \
  --transport file   # or: http
```

- Builds an `Effort` with a single `Task` and a generated UUID
- Submits via the selected `EffortTransportAdapter`
- Prints the `effortId` — does not wait for result (fire-and-observe)

### `refarm task status`

```bash
refarm task status <effort-id> \
  --transport file   # or: http
  --watch            # poll every 2s until done/failed
```

- Calls `adapter.query(effortId)` → prints each `TaskResult` status
- With `--watch`: polls until `EffortResult.status` is `"done"` or `"failed"`

### Transport resolution

```typescript
function resolveAdapter(transport: "file" | "http"): EffortTransportAdapter {
  if (transport === "http") return new HttpTransportAdapter("http://localhost:42001");
  return new FileTransportAdapter(path.join(os.homedir(), ".refarm"));
}
```

Default: `file` — works without Farmhand running.
`http`: requires Farmhand active on port 42001.

---

## Runtime Extensibility

Third-party adapters (GitHub Issues, Linear, Jira) are Refarm plugins that implement
`EffortSourceAdapter`. They install via `refarm plugin install` and are loaded into Farmhand
at runtime. No changes to the contract package or Farmhand core are needed.

```
effort-contract-v1            → stable interface (the seed)
@someone/github-issues-adapter → npm package implementing EffortSourceAdapter
                                  installed as a Refarm plugin
```

---

## Transport Selection (CLI)

Priority order:
1. `--transport` flag (explicit override)
2. `task.transport` in `refarm.config.json`
3. Default: `"file"`

---

## Test Strategy

- `packages/effort-contract-v1`: conformance tests (submit → query round-trip) runnable against any adapter
- `apps/farmhand`: unit test for `executeTask` with mock `PluginInstance`; integration test for `FileTransportAdapter` watcher
- `apps/refarm`: unit tests for `task run` (mock adapter) and `task status` (mock query result)

---

## Non-Goals

- CRDT/WebSocket transport (future lane — implement `EffortTransportAdapter` as a plugin)
- GitHub Issues adapter (future lane — same interface, different implementation)
- Effort grouping / dependency chains between tasks (YAGNI)
- Streaming task results (out of scope for v1 — polling covers the need)
