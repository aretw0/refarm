# Design: `task-contract-v1` + `session-contract-v1`

**Date**: 2026-05-03  
**Status**: Approved  
**Author**: Arthur Silva  
**Related ADRs**: ADR-045 (Loro CRDT), ADR-046 (Composition model), ADR-052 (CRDT-native agent rendezvous), ADR-056 (Unified host boundary)

---

## Context

Refarm has four foundational capability contracts: `storage-contract-v1`, `sync-contract-v1`,
`identity-contract-v1`, and `effort-contract-v1`. These cover persistence, CRDT sync, identity,
and task dispatch.

Two memory primitives are missing:

- **Durable work items** — tasks that outlive a single agent session, usable by both human
  users and agents from the same base schema.
- **Conversation threads** — session context shared across LLM agents, messaging integrations
  (Telegram, Signal), and future A2A coordination (ADR-052).

`pi-agent` currently owns both (`Session`/`SessionEntry` CRDT nodes) under the `urn:pi-agent:*`
namespace. This couples platform-level primitives to a single plugin's namespace.

This design graduates both into standalone capability contracts in `packages/`.

---

## Architecture

```
task-contract-v1   →  MEMORY layer  (what exists, persists in CRDT)
effort-contract-v1 →  DISPATCH layer (what executes, ephemeral transport)

composition (in consumer, not in packages):
  task-contract-v1.create(task)
      └─► effort-contract-v1.submit({ tasks: [{ fn: "execute", args: task.id }] })
```

The two packages never import each other. Composition happens in consumers
(pi-agent, farmhand, windmill) by combining both adapters.

---

## Package: `task-contract-v1`

**Location**: `packages/task-contract-v1`  
**Capability constant**: `"task:v1"`  
**Scope**: Durable work items — created by agents or humans, persisted in the CRDT graph,
surviving across sessions.

### Node schemas

**`Task`** — LWW (last-write-wins via Loro CRDT), mutable:

```json
{
  "@type":          "Task",
  "@id":            "urn:refarm:task:v1:{id}",
  "title":          "string",
  "status":         "pending | active | blocked | done | failed | cancelled | deferred",
  "created_by":     "urn:... | null",
  "assigned_to":    "urn:... | null",
  "context_id":     "urn:... | null",
  "parent_task_id": "urn:refarm:task:v1:{id} | null",
  "created_at_ns":  1234567890000000000,
  "updated_at_ns":  1234567890000000000
}
```

| Field | Notes |
|---|---|
| `status` | `pending` = not started; `active` = in progress; `blocked` = waiting on dependency; `done` = completed; `failed` = agent attempted, could not complete; `cancelled` = won't do (final); `deferred` = consciously postponed (agent may reactivate) |
| `created_by` | Any URN — agent, user, or system |
| `assigned_to` | Any URN — `null` means unassigned |
| `context_id` | Any URN — typically `urn:refarm:session:v1:*` or a project/vault URN |
| `parent_task_id` | Hierarchical decomposition only — not execution routing (see `effort-contract-v1`) |

**`TaskEvent`** — append-only, immutable:

```json
{
  "@type":        "TaskEvent",
  "@id":          "urn:refarm:task-event:v1:{id}",
  "task_id":      "urn:refarm:task:v1:{id}",
  "event":        "created | status_changed | assigned | noted | linked | blocked_by | unblocked",
  "actor":        "urn:...",
  "payload":      {},
  "timestamp_ns": 1234567890000000000
}
```

### TypeScript interface

```typescript
export const TASK_CAPABILITY = "task:v1" as const;

export type TaskStatus =
  | "pending" | "active" | "blocked"
  | "done" | "failed" | "cancelled" | "deferred";

export type TaskEventKind =
  | "created" | "status_changed" | "assigned"
  | "noted" | "linked" | "blocked_by" | "unblocked";

export interface Task {
  "@type": "Task";
  "@id": string;
  title: string;
  status: TaskStatus;
  created_by: string | null;
  assigned_to: string | null;
  context_id: string | null;
  parent_task_id: string | null;
  created_at_ns: number;
  updated_at_ns: number;
}

export interface TaskEvent {
  "@type": "TaskEvent";
  "@id": string;
  task_id: string;
  event: TaskEventKind;
  actor: string;
  payload: Record<string, unknown>;
  timestamp_ns: number;
}

export interface TaskFilter {
  status?: TaskStatus | TaskStatus[];
  assigned_to?: string;
  context_id?: string;
  parent_task_id?: string | null; // null = root tasks only
}

export interface TaskSummary {
  total: number;
  by_status: Record<TaskStatus, number>;
}

export interface TaskConformanceResult {
  pass: boolean;
  total: number;
  failed: number;
  failures: string[];
}

export interface TaskContractAdapter {
  // Required
  create(task: Omit<Task, "@id" | "created_at_ns" | "updated_at_ns">): Promise<Task>;
  get(id: string): Promise<Task | null>;
  update(id: string, patch: Partial<Omit<Task, "@id" | "@type">>): Promise<Task>;
  appendEvent(event: Omit<TaskEvent, "@id" | "timestamp_ns">): Promise<TaskEvent>;

  // Optional
  query?(filter: TaskFilter): Promise<Task[]>;
  events?(taskId: string): Promise<TaskEvent[]>;
  summary?(): Promise<TaskSummary>;
}

export function runTaskV1Conformance(
  adapter: TaskContractAdapter
): Promise<TaskConformanceResult>;
```

### Conformance tests (4 required + 3 optional)

| # | Method | What it validates |
|---|---|---|
| 1 | `create` | Returns Task with `@id`, `@type`, `created_at_ns`, `updated_at_ns` generated |
| 2 | `get` | Returns the same Task by `@id` |
| 3 | `update` | Patch changes target field, preserves others, updates `updated_at_ns` |
| 4 | `appendEvent` | Returns immutable TaskEvent linked to correct `task_id` |
| 5* | `query` | Filters by status correctly; `parent_task_id: null` returns only root tasks |
| 6* | `events` | Returns events in chronological order |
| 7* | `summary` | Counts match actual distribution |

\* Optional — only run when adapter implements the method.

---

## Package: `session-contract-v1`

**Location**: `packages/session-contract-v1`  
**Capability constant**: `"session:v1"`  
**Scope**: Conversation threads — LLM agents, messaging integrations, A2A coordination.
The base contract is agnostic of LLM branching semantics.

### Node schemas

**`Session`** — LWW, mutable:

```json
{
  "@type":         "Session",
  "@id":           "urn:refarm:session:v1:{id}",
  "participants":  ["urn:...", "urn:..."],
  "context_id":    "urn:... | null",
  "created_at_ns": 1234567890000000000
}
```

**`SessionEntry`** — append-only, immutable:

```json
{
  "@type":           "SessionEntry",
  "@id":             "urn:refarm:session-entry:v1:{id}",
  "session_id":      "urn:refarm:session:v1:{id}",
  "parent_entry_id": "urn:refarm:session-entry:v1:{id} | null",
  "kind":            "user | agent | tool_call | tool_result | system",
  "content":         "string",
  "timestamp_ns":    1234567890000000000
}
```

### TypeScript interface

```typescript
export const SESSION_CAPABILITY = "session:v1" as const;

export type SessionEntryKind =
  | "user" | "agent" | "tool_call" | "tool_result" | "system";

export interface Session {
  "@type": "Session";
  "@id": string;
  participants: string[];
  context_id: string | null;
  created_at_ns: number;
}

export interface SessionEntry {
  "@type": "SessionEntry";
  "@id": string;
  session_id: string;
  parent_entry_id: string | null;
  kind: SessionEntryKind;
  content: string;
  timestamp_ns: number;
}

export interface SessionFilter {
  participants?: string[];
  context_id?: string;
}

export interface SessionConformanceResult {
  pass: boolean;
  total: number;
  failed: number;
  failures: string[];
}

export interface SessionContractAdapter {
  // Required
  create(session: Omit<Session, "@id" | "created_at_ns">): Promise<Session>;
  get(id: string): Promise<Session | null>;
  update(id: string, patch: Partial<Omit<Session, "@id" | "@type">>): Promise<Session>;
  appendEntry(entry: Omit<SessionEntry, "@id" | "timestamp_ns">): Promise<SessionEntry>;

  // Optional
  entries?(sessionId: string, limit?: number): Promise<SessionEntry[]>;
  query?(filter: SessionFilter): Promise<Session[]>;
}

export function runSessionV1Conformance(
  adapter: SessionContractAdapter
): Promise<SessionConformanceResult>;
```

### Conformance tests (3 required + 2 optional)

| # | Method | What it validates |
|---|---|---|
| 1 | `create` | Returns Session with `@id`, `@type`, `created_at_ns` generated |
| 2 | `get` | Returns same Session by `@id` |
| 3 | `appendEntry` | Returns SessionEntry linked to correct `session_id`; `parent_entry_id` chain is correct |
| 4* | `entries` | Returns entries in chronological order; `limit` is respected |
| 5* | `query` | Filters by `participants` correctly |

\* Optional.

---

## Pi-agent migration

Pi-agent extends `session-contract-v1` with LLM-specific fields without coupling the contract:

```
// session-contract-v1 base (platform)
Session:      @id, participants, context_id, created_at_ns
SessionEntry: @id, session_id, parent_entry_id, kind, content, timestamp_ns

// pi-agent extension (plugin-local, extra CRDT fields)
Session + { name, leaf_entry_id, parent_session_id }
```

Since CRDT nodes are schema-free (Extensibility Axiom A5), pi-agent stores extra fields
alongside the base fields. Consumers that only know `session-contract-v1` safely ignore them.

**Namespace migration** (one-time script, pre-v0.1.0):
- Old: `urn:pi-agent:session-{id}` → New: `urn:refarm:session:v1:{id}`
- Old: `urn:pi-agent:entry-{id}` → New: `urn:refarm:session-entry:v1:{id}`
- Timing: before daily-driver gate, while dataset is small and personal.

---

## Composition example

```typescript
// pi-agent creates a task when processing a user prompt that implies work
const task = await taskAdapter.create({
  "@type": "Task",
  title: "Implement dark mode toggle",
  status: "active",
  created_by: agentUrn,
  assigned_to: agentUrn,
  context_id: currentSessionId,   // links task ↔ conversation
  parent_task_id: null,
});

await taskAdapter.appendEvent({
  "@type": "TaskEvent",
  task_id: task["@id"],
  event: "created",
  actor: agentUrn,
  payload: { source: "user_prompt", prompt_ref: promptId },
});

// when execution is needed, dispatch via effort-contract-v1
await effortAdapter.submit({
  id: newId(),
  direction: "execute-task",
  tasks: [{ id: newId(), pluginId: "pi_agent", fn: "execute", args: task["@id"] }],
  submittedAt: new Date().toISOString(),
});
```

---

## What this unlocks

| Consumer | Benefit |
|---|---|
| `pi-agent` | Tasks persist across sessions; session schema is platform-standard |
| `farmhand` | Reads/writes same Task nodes without knowing pi-agent internals |
| `apps/me` (Homestead) | Shows task list and conversation history via standard adapters |
| Messaging integrations | `session-contract-v1` adapter per platform (Telegram, Signal) |
| `windmill` | Automation creates/updates tasks via standard contract |
| A2A (ADR-052) | `AgentTask` from ADR-052 is implemented as `Task` nodes + this contract |

---

## Out of scope (v2+)

- `task-contract-v2`: task templates, recurring tasks, dependencies between tasks
- `session-contract-v2`: multi-party moderation, session archiving, read receipts
- A2A edge adapters (ADR-052): expose sessions/tasks over A2A HTTP after CRDT model is proven
- `AgentProfile` schema (ADR-052): separate design, depends on `session-contract-v1` being stable
