# ADR-057: `task-contract-v1` + `session-contract-v1` — Memory Layer Contracts

## Status

**Accepted**

## Date

2026-05-03

## Authors

Refarm Team

## Related

ADR-045 (Loro CRDT), ADR-046 (Composition model), ADR-052 (CRDT-native agent rendezvous),
ADR-056 (Unified host boundary)

---

## Context

Refarm has five capability contracts covering transport, persistence, sync, identity, and
streaming. One layer is missing: **memory** — durable work items and conversation threads
that persist in the CRDT graph across agent sessions.

Currently, `pi-agent` owns `Session` and `SessionEntry` CRDT nodes under the
`urn:pi-agent:*` namespace. This couples platform-level primitives to a single plugin.
Any consumer (farmhand, messaging integrations, `apps/me`) that wants to read sessions
must depend on pi-agent's private schema. This violates ADR-046's principle that blocks
are philosophy-neutral and independently usable.

`AgentTask` (proposed in ADR-052) has no contract yet. The design decision between
"informal schema in pi-agent namespace", "shared schema in agent-tools", and "formal
capability contract" was pending.

## Decision

Introduce two new capability contracts in `packages/`:

### `task-contract-v1` — Durable work items

A capability contract for work items that persist in the CRDT graph. Designed for both
human tasks (created in Homestead) and agent tasks (created by pi-agent, farmhand) using
the same base schema. Divergence into specialised types happens in consumers when evidence
demands it, not speculatively.

**Relationship with `effort-contract-v1`**: the two contracts are at different layers and
never import each other. `effort-contract-v1` is the dispatch (transport) layer — ephemeral,
execution-oriented. `task-contract-v1` is the memory layer — persistent, CRDT-backed.
Composition happens in consumers: a Task can be dispatched as an Effort when execution is
needed.

### `session-contract-v1` — Conversation threads

A capability contract for conversation threads, graduating `Session`/`SessionEntry` out of
pi-agent's namespace. The base contract is agnostic of LLM branching semantics — it covers
the minimum required by any thread consumer (LLM agents, messaging integrations, A2A).

Pi-agent extends the base contract by storing extra CRDT fields (`leaf_entry_id`,
`parent_session_id`, `name`) alongside the base fields. Since CRDT nodes are schema-free
(Extensibility Axiom A5), base contract consumers safely ignore these fields.

### Node schemas

**`Task`** (`urn:refarm:task:v1:{id}`): `title`, `status` (7 values), `created_by`,
`assigned_to`, `context_id`, `parent_task_id`, timestamps.

**`TaskEvent`** (`urn:refarm:task-event:v1:{id}`): append-only event log for a Task.

**`Session`** (`urn:refarm:session:v1:{id}`): `participants[]`, `context_id`, `created_at_ns`.

**`SessionEntry`** (`urn:refarm:session-entry:v1:{id}`): append-only, `parent_entry_id`
linked list for branch-safe history walks.

Full schemas and TypeScript interfaces: [design spec](../../docs/superpowers/specs/2026-05-03-task-session-contracts-design.md).

### Pi-agent namespace migration

Existing pi-agent nodes use `urn:pi-agent:session-{id}` and `urn:pi-agent:entry-{id}`.
A one-time migration script rewrites these to `urn:refarm:session:v1:*` before the
daily-driver gate. Timing is safe: the dataset is personal and pre-v0.1.0.

## Consequences

**Positive:**
- Any consumer (farmhand, `apps/me`, messaging bots, windmill) reads/writes Tasks and
  Sessions via standard adapters without depending on pi-agent internals.
- `AgentTask` from ADR-052 is implemented as `Task` nodes — no separate design needed.
- `session-contract-v1` is the foundation for A2A edge adapters (ADR-052 phase 2).
- Follows the established pattern: immutable contract + conformance tests + pluggable adapters.

**Costs:**
- Pi-agent requires a one-time namespace migration (low risk pre-v0.1.0).
- Two new packages to scaffold and maintain.
- Publication deferred to v0.2.0 — needs daily-driver validation before ecosystem exposure.

## Alternatives considered

**A — Informal schema in pi-agent namespace**: zero infraestructure, but couples all
consumers to pi-agent and prevents the session primitive from being reused by messaging
integrations or A2A without ad-hoc coupling.

**B — Shared schema in `packages/agent-tools`**: avoids a formal contract, but creates
an informal dependency without conformance guarantees. The existing pattern (effort, storage,
sync, identity, stream) is always a formal contract — there is no precedent for an informal
shared schema package.

**C — Extend `effort-contract-v1`**: effort is transport, task is memory — merging them
would conflate two orthogonal concerns and make the contract harder to implement for
consumers that only need one layer.
