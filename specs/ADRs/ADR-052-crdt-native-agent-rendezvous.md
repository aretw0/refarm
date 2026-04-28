# ADR-052: CRDT-native agent rendezvous with A2A-compatible edges

## Status

**Proposed**

## Context

Farmhand already stores sessions, entries, usage, responses, and tool traces as CRDT nodes. Recent swarm harness work proves that two farmhand instances can coordinate by reading the same CRDT graph without direct runtime coupling.

The next question is how Refarm should interoperate with broader agent-to-agent ecosystems without turning farmhand into a protocol-specific silo.

Current external signals:

- **A2A / Agent2Agent** defines peer-agent collaboration over HTTP(S), JSON-RPC 2.0, optional SSE streaming, Agent Cards at `/.well-known/agent.json`, and task/message/artifact primitives. A2A is strong at opaque-agent delegation and enterprise web compatibility.
- **MCP** is primarily agent-to-tool/resource context, not agent-to-agent state. It is useful as an adapter surface for tools and external resources, but should not be the source of truth for farmhand coordination.
- **AgentCard / ARDP / JSON-LD drafts** point toward framework-neutral discovery records: identity, capabilities, endpoints, protocol support, and security requirements. These are still draft-level signals but align with Refarm's JSON-LD/CRDT model.

## Decision

Refarm will treat the local CRDT graph as the canonical rendezvous layer for farmhand-to-farmhand coordination, and expose A2A-compatible edge adapters later instead of adopting A2A as the internal state model.

The candidate CRDT primitives are:

### `AgentProfile`

A JSON-LD node describing an agent identity and its advertised capabilities.

Minimum fields:

- `@type: "AgentProfile"`
- `agent_id`
- `display_name`
- `protocols`: e.g. `[{ name: "refarm-crdt", version }, { name: "a2a", version, endpoint? }]`
- `skills`: capability list inspired by A2A `AgentSkill`
- `input_modes` / `output_modes`
- `auth`: declaration only, never plaintext secrets
- `updated_at_ns`

### `AgentTask`

A durable work item that can be claimed, progressed, completed, failed, or canceled.

Minimum fields:

- `@type: "AgentTask"`
- `task_id`
- `context_id`
- `created_by_agent_id`
- `assigned_agent_id` or `candidate_skill_tags`
- `status`: `submitted | working | input-required | completed | canceled | failed | rejected | auth-required`
- `input_entry_ids`
- `artifact_ids`
- `updated_at_ns`

The status vocabulary intentionally mirrors A2A `TaskState` so future gateways can translate with minimal impedance.

### `AgentMessage`

A communication turn associated with a task or context.

Minimum fields:

- `@type: "AgentMessage"`
- `message_id`
- `context_id`
- `task_id?`
- `sender_agent_id`
- `role`: `user | agent | system`
- `parts`: array of `{ kind: text | data | file, ... }`, mirroring A2A parts
- `parent_message_id?`
- `timestamp_ns`

### `AgentArtifact`

A task output, potentially chunked or externally referenced.

Minimum fields:

- `@type: "AgentArtifact"`
- `artifact_id`
- `task_id`
- `producer_agent_id`
- `parts`: array of text/data/file references
- `append_of?`
- `is_final`
- `timestamp_ns`

## A2A compatibility strategy

A future HTTP adapter can map:

- Agent Card ⇄ `AgentProfile`
- A2A `Task` ⇄ `AgentTask`
- A2A `Message` ⇄ `AgentMessage`
- A2A `Artifact` ⇄ `AgentArtifact`
- A2A SSE status/artifact updates ⇄ CRDT subscriptions / node change stream

This keeps farmhand offline-first and local-first while allowing interop at network boundaries.

## MCP compatibility strategy

MCP remains a tool/resource adapter layer. A farmhand instance may expose selected Refarm tools as MCP servers or consume MCP servers through host capabilities, but MCP should not own session history, task state, or cross-agent rendezvous.

## Consequences

### Positive Consequences

- Preserves Refarm's offline-first CRDT source of truth.
- Avoids coupling farmhand core to any single network protocol.
- Keeps future A2A integration straightforward by aligning task/message/artifact vocabulary early.
- Allows local multi-agent coordination without HTTP, webhooks, or always-online assumptions.
- Makes JSON-LD identity/capability records natural and queryable inside the existing graph.

### Negative Consequences

- Requires an adapter layer before speaking native A2A to external agents.
- Requires careful schema discipline to avoid inventing a near-A2A model that diverges in subtle ways.
- Security and discovery are not solved by the CRDT schema alone; signed AgentProfile records and capability policy still need separate decisions.

## Alternatives Considered

- **Adopt A2A internally:** rejected for now. A2A assumes HTTP(S), JSON-RPC, and opaque remote agents. Farmhand's primary coordination substrate is local CRDT state, including offline and same-process swarms.
- **Use MCP as the multi-agent layer:** rejected. MCP is best suited to tool/resource exposure, not durable task ownership and peer-agent state.
- **Invent a Refarm-only protocol with no A2A alignment:** rejected. A2A's task/message/artifact vocabulary is close enough to use as compatibility pressure, reducing future gateway work.

## Next Steps

1. Add schema docs for `AgentProfile`, `AgentTask`, `AgentMessage`, and `AgentArtifact` before implementing network adapters.
2. Extend the swarm harness so agent B claims or responds to an `AgentTask`, not just reads agent A's `AgentResponse`.
3. Defer HTTP A2A gateway implementation until local CRDT task semantics are stable.
