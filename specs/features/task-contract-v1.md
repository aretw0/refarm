# Feature: task-contract-v1 — Durable Work Items (Memory Layer)

**Status**: In Progress (TDD baseline complete)
**Version**: v0.2.0
**Owner**: Arthur Silva

---

## Summary

Introduces `task-contract-v1` as a formal capability contract for durable work items
persisted in the CRDT graph. Tasks outlive individual agent sessions and are usable by
both human users (Homestead) and agents (pi-agent, farmhand) from the same base schema.
`task-contract-v1` is the **memory layer** — complementing `effort-contract-v1`'s
**dispatch layer** — and the two packages never import each other; composition happens
in consumers.

---

## User Stories

**As a** pi-agent  
**I want** to create a `Task` node when a user prompt implies persistent work  
**So that** the task survives across sessions and I can resume it without re-reading
the full conversation history

**As a** Homestead user  
**I want** to see my task list in the UI from a stable contract  
**So that** the view does not break when pi-agent's internal schema evolves

**As a** farmhand automation  
**I want** to read and update `Task` nodes without depending on pi-agent internals  
**So that** I can coordinate work with agents via a shared memory contract

**As a** third-party plugin author  
**I want** `task-contract-v1` to define a stable, adapter-based interface  
**So that** I can build a task storage backend (SQLite, Loro CRDT, remote) without
modifying core Refarm packages

---

## Acceptance Criteria

1. **Given** `task-contract-v1` is installed as a dependency  
   **When** a third party implements `TaskContractAdapter`  
   **Then** running `runTaskV1Conformance(adapter)` reports all 4 required tests passing

2. **Given** pi-agent processes a user prompt that implies work  
   **When** it calls `taskAdapter.create()`  
   **Then** a `Task` node with `urn:refarm:task:v1:{id}` is written to the CRDT graph  
   and survives a session restart

3. **Given** a Task exists with `status: "pending"`  
   **When** pi-agent calls `taskAdapter.update(id, { status: "active" })`  
   **Then** `updated_at_ns` advances and the change is reflected in Homestead's task list

4. **Given** a status change happens  
   **When** pi-agent calls `taskAdapter.appendEvent()`  
   **Then** an immutable `TaskEvent` node is written and readable via `adapter.events(taskId)`

5. **Given** a `TaskContractAdapter` with `query` implemented  
   **When** `query({ parent_task_id: null })` is called  
   **Then** only root tasks are returned (no subtasks in the result)

6. **Given** farmhand wants to dispatch a Task for execution  
   **When** it composes `task-contract-v1` with `effort-contract-v1`  
   **Then** a new Effort is submitted without either package importing the other

---

## Technical Approach

**Layered design:**

```
task-contract-v1   →  MEMORY layer  (what exists, persists in CRDT graph)
effort-contract-v1 →  DISPATCH layer (what executes, ephemeral transport)

composition (in consumer, never in packages):
  taskAdapter.create(task)
      └─► effortAdapter.submit({ tasks: [{ fn: "execute", args: task["@id"] }] })
```

**Node schemas:**

```
Task       urn:refarm:task:v1:{id}        LWW, mutable
TaskEvent  urn:refarm:task-event:v1:{id}  append-only, immutable
```

**Package layout:**

```
packages/
  task-contract-v1/        ← contract types + conformance runner

consumers (implement the adapter):
  packages/storage-sqlite/ ← future: TaskContractAdapter backed by Loro CRDT + SQLite
  apps/pi-agent/           ← uses taskAdapter to create/update Task nodes
  apps/farmhand/           ← reads Task nodes for scheduling/dispatching
  apps/me/ (Homestead)     ← reads Task nodes for the task list UI
```

**Key decisions:**

- `task-contract-v1` is a separate package so any consumer can depend on it without
  taking pi-agent as a transitive dependency — mirrors the `effort-contract-v1` model.
- Human tasks (Homestead) and agent tasks (pi-agent) use the same `Task` node schema.
  Divergence into specialised types happens in consumers if evidence demands it.
- `TaskEvent` is append-only for audit trail integrity — no update or delete method
  is exposed in the contract.
- Optional methods (`query`, `events`, `summary`) allow lightweight adapters to pass
  conformance with just the 4 required methods.
- Publication deferred to v0.2.0: needs daily-driver validation by pi-agent and
  farmhand before ecosystem exposure.

---

## API/Interface

```typescript
// packages/task-contract-v1/src/types.ts

export const TASK_CAPABILITY = "task:v1" as const;

export type TaskStatus =
  | "pending" | "active" | "blocked"
  | "done" | "failed" | "cancelled" | "deferred";

export type TaskEventKind =
  | "created" | "status_changed" | "assigned"
  | "noted" | "linked" | "blocked_by" | "unblocked";

export interface Task {
  "@type": "Task";
  "@id": string;              // urn:refarm:task:v1:{id}
  title: string;
  status: TaskStatus;
  created_by: string | null;  // any URN — agent, user, or system
  assigned_to: string | null; // any URN — null means unassigned
  context_id: string | null;  // typically a session or project URN
  parent_task_id: string | null;
  created_at_ns: number;
  updated_at_ns: number;
}

export interface TaskEvent {
  "@type": "TaskEvent";
  "@id": string;              // urn:refarm:task-event:v1:{id}
  task_id: string;
  event: TaskEventKind;
  actor: string;
  payload: Record<string, unknown>;
  timestamp_ns: number;
}

export interface TaskContractAdapter {
  create(task: Omit<Task, "@id" | "created_at_ns" | "updated_at_ns">): Promise<Task>;
  get(id: string): Promise<Task | null>;
  update(id: string, patch: Partial<Omit<Task, "@id" | "@type">>): Promise<Task>;
  appendEvent(event: Omit<TaskEvent, "@id" | "timestamp_ns">): Promise<TaskEvent>;
  query?(filter: TaskFilter): Promise<Task[]>;
  events?(taskId: string): Promise<TaskEvent[]>;
  summary?(): Promise<TaskSummary>;
}

export function runTaskV1Conformance(
  adapter: TaskContractAdapter
): Promise<TaskConformanceResult>;
```

---

## Test Coverage

**Conformance tests (required — any adapter):**

- [x] `create()` returns Task with `@id`, `@type`, `created_at_ns`, `updated_at_ns` set
- [x] `get()` returns the same Task by `@id`
- [x] `update()` changes target field, preserves others, advances `updated_at_ns`
- [x] `appendEvent()` returns immutable TaskEvent linked to correct `task_id`

**Conformance tests (optional — run when adapter implements the method):**

- [x] `query({ status })` filters correctly
- [x] `query({ parent_task_id: null })` returns only root tasks
- [x] `events(taskId)` returns events in chronological order
- [x] `summary()` counts match actual distribution

**Integration tests (in adapters, not in this package):**

- [ ] Loro CRDT adapter: Task node survives a snapshot/restore cycle
- [ ] Loro CRDT adapter: concurrent `update()` from two writers converges via LWW

---

## Implementation Tasks

**SDD:**

- [x] Design `Task` / `TaskEvent` / `TaskContractAdapter` TypeScript interfaces
- [x] Design `runTaskV1Conformance` test harness
- [x] Write design doc (`docs/superpowers/specs/2026-05-03-task-session-contracts-design.md`)
- [x] Write ADR-057 (`specs/ADRs/ADR-057-task-session-contracts.md`)
- [x] Write feature spec (this document)

**TDD:**

- [x] Conformance runner in `packages/task-contract-v1/src/conformance.ts`
- [x] In-memory adapter that passes all 7 conformance checks

**DDD:**

- [x] Scaffold `packages/task-contract-v1/` with types, conformance runner, in-memory adapter
- [x] Integrate `TaskContractAdapter` into farmhand execution loop (bridge effort tasks ↔ Task/TaskEvent status updates)
- [ ] Integrate `TaskContractAdapter` into pi-agent (create/update/appendEvent on prompt)
- [ ] Expose Task list in Homestead via standard adapter
- [x] Implement `TaskContractAdapter` baseline in `storage-sqlite` (storage:v1-backed records)
- [ ] Upgrade `storage-sqlite` Task adapter to direct Loro CRDT-backed nodes
- [ ] Smoke gate: pi-agent creates Task → node in CRDT graph → Homestead reads it

---

## References

- [Design doc](../../docs/superpowers/specs/2026-05-03-task-session-contracts-design.md)
- [ADR-057: task-contract-v1 + session-contract-v1](../ADRs/ADR-057-task-session-contracts.md)
- [ADR-052: CRDT-native agent rendezvous](../ADRs/ADR-052-crdt-native-agent-rendezvous.md)
- [ADR-046: Composition model](../ADRs/ADR-046-composition-model.md)
- [session-contract-v1 spec](./session-contract-v1.md)
- [Farmhand Task Execution spec](./farmhand-task-execution.md)
