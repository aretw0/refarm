# Feature: Farmhand Task Execution — effort-contract-v1

**Status**: In Progress
**Version**: v0.1.0
**Owner**: Arthur Silva

---

## Summary

Completes the `FarmhandTask` execution pipeline and establishes `effort-contract-v1` as an open capability contract for structured work items. An *Effort* is the directional context (the "why") — mapping to any platform's work item (GitHub Issue, Linear ticket, commit, CLI dispatch). A *Task* is the atomic execution unit inside an effort: call a loaded plugin function with given args. Farmhand executes tasks from two bundled transports (File and HTTP), while third-party adapters (GitHub Issues, Linear, Jira) can implement the same interface as Refarm plugins — no changes to the core needed.

---

## User Stories

**As a** Refarm developer
**I want** to dispatch a task to a running plugin via `refarm task run`
**So that** I can trigger automation from the terminal without opening Studio

**As a** Refarm developer
**I want** `refarm task status <effort-id>` to show whether my task completed or failed
**So that** I can observe results without polling a database manually

**As a** third-party contributor
**I want** `effort-contract-v1` to define a stable, platform-neutral interface
**So that** I can build a GitHub Issues adapter that Farmhand consumes without touching Refarm internals

---

## Acceptance Criteria

1. **Given** Farmhand is running with a plugin loaded
   **When** a `FarmhandTask` CRDT node arrives via sync
   **Then** the plugin function is invoked and a `FarmhandTaskResult` node is written back to the graph

2. **Given** `refarm task run my-plugin process --args '{"x":1}' --direction "Test run"`
   **When** executed with `--transport file`
   **Then** an `effortId` is printed and an Effort file appears in `~/.refarm/tasks/`

3. **Given** Farmhand is watching `~/.refarm/tasks/`
   **When** an Effort file is written
   **Then** each Task is executed in order and an EffortResult is written to `~/.refarm/task-results/<effortId>.json`

4. **Given** `refarm task status <effort-id>`
   **When** execution has completed
   **Then** each TaskResult's status (ok/error) and result/error is printed

5. **Given** `refarm task status <effort-id> --watch`
   **When** execution is still pending
   **Then** the CLI polls every 2s until status is `done` or `failed`

6. **Given** an `EffortTransportAdapter` implementation
   **When** it satisfies the `effort-contract-v1` interface
   **Then** it can be installed as a Refarm plugin and used without modifying Farmhand

---

## Technical Approach

**High-level design:**

```
packages/effort-contract-v1          → Effort, Task, TaskResult, EffortResult
                                       EffortSourceAdapter, EffortTransportAdapter

apps/farmhand
  ├── src/task-executor.ts            → completes handleFarmhandTask (CRDT path)
  ├── src/transports/file.ts          → FileTransportAdapter (fs.watch on ~/.refarm/tasks/)
  └── src/transports/http.ts          → HTTP sidecar on port 42001

apps/refarm
  └── src/commands/task.ts            → refarm task run + refarm task status
```

**Semantic model:**

```
Effort (context + direction — only the user knows why)
  └── Task[] (call pluginId.fn(args))
        └── TaskResult (ok/error + result/message)
```

`direction` and `context` are user-owned and opaque to Farmhand — preserved for traceability.

**Transport paths (independent, coexist in same process):**

- **File transport**: writes/watches `~/.refarm/tasks/` and `~/.refarm/task-results/`
- **HTTP sidecar**: `POST /efforts` + `GET /efforts/:id` on port 42001
- **CRDT path** (existing): `tractor.onNode("FarmhandTask")` → `tractor.storeNode(FarmhandTaskResult)`

**Key decisions:**

- `effort-contract-v1` has zero runtime dependencies — pure types and interfaces
- Third-party adapters are Refarm plugins implementing `EffortSourceAdapter` — no new extension mechanism
- Default CLI transport is `file` (works without Farmhand running)
- HTTP sidecar is optional — Farmhand boots cleanly without it

---

## API/Interface

```typescript
// packages/effort-contract-v1

export interface Task {
  id: string;
  pluginId: string;
  fn: string;
  args?: unknown;
}

export interface Effort {
  id: string;
  direction: string;
  tasks: Task[];
  source?: string;
  context?: unknown;
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

export interface EffortSourceAdapter {
  submit(effort: Effort): Promise<string>;
}

export interface EffortTransportAdapter extends EffortSourceAdapter {
  query(effortId: string): Promise<EffortResult | null>;
  subscribe?(fn: (result: EffortResult) => void): () => void;
}

export const EFFORT_CAPABILITY = Symbol("EffortTransportAdapter");
```

---

## Test Coverage

**Unit tests (TDD):**

- [ ] `effort-contract-v1` — conformance tests: submit → query round-trip for any adapter
- [ ] `FileTransportAdapter` — submit writes file; watcher picks up + writes result
- [ ] `HttpTransportAdapter` — POST /efforts returns effortId; GET /efforts/:id returns EffortResult
- [ ] `task-executor` — plugin found → ok result; plugin missing → error result; plugin throws → error result
- [ ] `refarm task run` — builds Effort with single Task; calls adapter.submit; prints effortId
- [ ] `refarm task status` — calls adapter.query; prints each TaskResult; `--watch` polls until terminal status

---

## Implementation Tasks

**SDD:**

- [x] Design effort-contract-v1 data model and adapter interfaces
- [x] Write feature spec

**TDD:**

- [ ] `effort-contract-v1` conformance tests
- [ ] `FileTransportAdapter` tests
- [ ] `HttpTransportAdapter` tests
- [ ] `task-executor` unit tests
- [ ] `refarm task run` + `refarm task status` tests

**DDD:**

- [ ] Scaffold `packages/effort-contract-v1`
- [ ] Complete `handleFarmhandTask` → `src/task-executor.ts`
- [ ] Implement `FileTransportAdapter` in Farmhand
- [ ] Implement HTTP sidecar in Farmhand
- [ ] Add `refarm task` command to `apps/refarm`
- [ ] Wire both transports on Farmhand boot
- [ ] Smoke gate: all workspaces green

---

## References

- [Design doc](../../docs/superpowers/specs/2026-05-01-farmhand-task-execution-design.md)
- [ADR-007](../ADRs/ADR-007-observability-primitives.md)
- [ADR-018](../ADRs/ADR-018-capability-contracts-and-observability-gates.md)
