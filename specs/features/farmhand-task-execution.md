# Feature: Farmhand Task Execution — effort-contract-v1

**Status**: Implemented with a known coordination-boundary debt
**Version**: v0.1.0
**Owner**: Arthur Silva

---

## Summary

Completes the `FarmhandTask` execution pipeline and establishes `effort-contract-v1` as an open capability contract for structured work items. An *Effort* is the directional context (the "why") — mapping to any platform's work item (GitHub Issue, Linear ticket, commit, CLI dispatch). A *Task* is the atomic execution unit inside an effort: call a loaded plugin function with given args. Refarm currently exposes file, HTTP, and channel dispatch paths; their implementation is functional but not symmetric at the package boundary.

## Current Implementation Reality (2026-08-06)

| Concern | Current implementation |
|---|---|
| Neutral effort contract | `packages/effort-contract-v1` owns the types and adapter interface. |
| File client | Private `FileTransportClient` in `apps/refarm/src/commands/task-support.ts`. |
| HTTP client | Private `HttpTransportClient` in the same app file; it implements `TaskOperationsAdapter` and calls `/efforts`. |
| Channel client | Private `HttpChannelTransportClient`; `dispatch-surface` supplies channel capabilities and path construction. |
| HTTP server ingress | `HttpSidecar` in `apps/farmhand/src/transports/http.ts`. |
| Neutral server boundary | `EffortOperations` in `apps/farmhand/src/effort-operations.ts`; HTTP and channel ingress depend on it. |
| Effort persistence | `FileEffortRepository` owns effort/result JSON and log NDJSON formats. |
| Shared server operations | The current composition supplies `FileTransportAdapter` as the `EffortOperations` implementation; it delegates persistence but still owns queueing, processing, status aggregation, retry, and cancellation. |

The HTTP path therefore **exists end to end**, but the reusable `HttpTransportAdapter`
described by the original design was not delivered as a block. Its role was split
between an app-private HTTP client and an app-private server ingress. The server-side
dependency is now expressed through the neutral `EffortOperations` boundary, but its
only implementation remains `FileTransportAdapter`, which is both a file ingress and
the shared lifecycle coordinator. Filesystem wire formats have moved to
`FileEffortRepository`; queueing and lifecycle policy have not yet moved to a neutral
coordinator. Diagrams must show this composition rather than presenting file and HTTP
as symmetric implementations.

The safe refactoring order is:

1. [Done] Name the transport-neutral server operations required by ingress adapters.
2. [Done] Extract filesystem persistence and wire formats from `FileTransportAdapter`.
3. Extract queueing and lifecycle coordination without changing behavior.
4. Make file watching and `HttpSidecar` separate ingress adapters over that coordinator.
5. Extract the HTTP client into a reusable package only when a second consumer needs it.
6. Prove file/HTTP behavioral parity against the same conformance cases before changing defaults.

Do not implement a second server-side execution path merely to satisfy the old name;
that would duplicate lifecycle, persistence, and control semantics instead of fixing the boundary.

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
**So that** I can build a GitHub Issues adapter that a Refarm host can compose without changing the contract

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
   **Then** it can be composed by a host without changing the contract

Plugin installation of arbitrary third-party effort adapters remains architectural intent;
the current Farmhand composition does not dynamically load such an adapter from the contract alone.

---

## Technical Approach

**High-level design:**

```
packages/effort-contract-v1          → Effort, Task, TaskResult, EffortResult
                                       EffortSourceAdapter, EffortTransportAdapter

apps/farmhand
  ├── src/effort-operations.ts         → neutral server operations boundary
  ├── src/task-executor.ts            → completes handleFarmhandTask (CRDT path)
  ├── src/transports/file-effort-repository.ts → JSON/NDJSON effort persistence
  ├── src/transports/file.ts          → FileTransportAdapter (fs.watch on ~/.refarm/tasks/)
  └── src/transports/http.ts          → HTTP sidecar on port 42001

apps/refarm
  ├── src/commands/task.ts            → refarm task run + refarm task status
  └── src/commands/task-support.ts    → private file, HTTP, and channel clients
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
- **HTTP client**: app-private `HttpTransportClient` calls the sidecar
- **HTTP sidecar**: `POST /efforts` + `GET /efforts/:id` on port 42001, depending on `EffortOperations`; boot currently supplies `FileTransportAdapter`
- **CRDT path** (existing): `tractor.onNode("FarmhandTask")` → `tractor.storeNode(FarmhandTaskResult)`

**Key decisions:**

- `effort-contract-v1` has zero runtime dependencies — pure types and interfaces
- `EffortSourceAdapter` permits host composition; dynamic Farmhand plugin activation is not implemented by this feature
- Default CLI transport is `file` (works without Farmhand running)
- HTTP transport is a client/server path, not a standalone reusable adapter package

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

- [x] `effort-contract-v1` — conformance tests exercise submit/query behavior
- [x] `FileTransportAdapter` — submit, watcher, result, logs, and lifecycle behavior
- [x] HTTP path — client requests plus `HttpSidecar` submit/query/control behavior
- [x] `task-executor` — success and failure execution paths
- [x] `refarm task run` — builds and submits an Effort
- [x] `refarm task status` — queries results and supports bounded watch polling

---

## Implementation Tasks

**SDD:**

- [x] Design effort-contract-v1 data model and adapter interfaces
- [x] Write feature spec

**TDD:**

- [x] `effort-contract-v1` conformance tests
- [x] `FileTransportAdapter` tests
- [x] HTTP client/sidecar path tests
- [x] `task-executor` unit tests
- [x] `refarm task run` + `refarm task status` tests

**DDD:**

- [x] Scaffold `packages/effort-contract-v1`
- [x] Complete task execution in `src/task-executor.ts`
- [x] Implement `FileTransportAdapter` in Farmhand
- [x] Implement HTTP sidecar in Farmhand
- [x] Add `refarm task` command to `apps/refarm`
- [x] Wire file and HTTP paths on Farmhand boot
- [x] Name the transport-neutral `EffortOperations` boundary used by HTTP and channel ingress
- [x] Extract effort/result/log persistence into `FileEffortRepository`
- [ ] Extract transport-neutral effort coordination from `FileTransportAdapter`
- [ ] Demonstrate a second consumer before extracting the app-private HTTP client

---

## References

- [ADR-007](../ADRs/ADR-007-observability-primitives.md)
- [ADR-018](../ADRs/ADR-018-capability-contracts-and-observability-gates.md)
