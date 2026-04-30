# pi-agent CRDT Node Schema

CRDT nodes are schema-free JSON blobs — the tractor host accepts any `@type` without
prior registration (Extensibility Axiom A5). This document is the authoritative contract
for nodes owned by pi-agent.

---

## Session

Represents a conversation thread. `leaf_entry_id` is the movable pointer to the current
tip of the conversation tree. Moving it is the `navigate` operation. Forking creates a
new Session with `parent_session_id` pointing to the ancestor session.

```json
{
  "@type":             "Session",
  "@id":               "urn:pi-agent:session-{new_id()}",
  "name":              "string | null",
  "leaf_entry_id":     "urn:pi-agent:entry-{id} | null",
  "parent_session_id": "urn:pi-agent:session-{id} | null",
  "created_at_ns":     1234567890000000000
}
```

| Field               | Type             | Required | Notes                                     |
|---------------------|------------------|----------|-------------------------------------------|
| `@type`             | `"Session"`      | yes      | Discriminant for `query_nodes`            |
| `@id`               | URN string       | yes      | `urn:pi-agent:session-{new_id()}`         |
| `name`              | string \| null   | no       | Human-readable label                      |
| `leaf_entry_id`     | URN string \| null | no     | Current tip; null = empty session         |
| `parent_session_id` | URN string \| null | no     | Non-null only when this session is a fork |
| `created_at_ns`     | u64 nanoseconds  | yes      | Wall-clock at creation                    |

**Update semantics**: `store_node` on the same `@id` is last-write-wins in the Loro CRDT.
To update `leaf_entry_id`, read the existing node, patch the field, and re-store.

---

## SessionEntry

One message in a conversation tree. The `parent_entry_id` field forms an immutable
linked-list / DAG — a node always knows its parent, never its children. Branching happens
naturally: two entries with the same `parent_entry_id` are a fork at that point.

```json
{
  "@type":           "SessionEntry",
  "@id":             "urn:pi-agent:entry-{new_id()}",
  "session_id":      "urn:pi-agent:session-{id}",
  "parent_entry_id": "urn:pi-agent:entry-{id} | null",
  "kind":            "user | agent | tool_call | tool_result",
  "content":         "string",
  "timestamp_ns":    1234567890000000000
}
```

| Field             | Type                        | Required | Notes                                          |
|-------------------|-----------------------------|----------|------------------------------------------------|
| `@type`           | `"SessionEntry"`            | yes      | Discriminant for `query_nodes`                 |
| `@id`             | URN string                  | yes      | `urn:pi-agent:entry-{new_id()}`                |
| `session_id`      | URN string                  | yes      | Owning Session                                 |
| `parent_entry_id` | URN string \| null          | no       | null = tree root; non-null = chained entry     |
| `kind`            | enum string                 | yes      | `user` \| `agent` \| `tool_call` \| `tool_result` |
| `content`         | string                      | yes      | Prompt text, response text, or tool payload    |
| `timestamp_ns`    | u64 nanoseconds             | yes      | Wall-clock at creation                         |

**Branching**: When a user navigates back (via `navigate`) and sends a new message, the
new SessionEntry gets `parent_entry_id = current leaf` (which is an ancestor, not the
original tip). This creates a natural branch — the old path is untouched in the CRDT.

**History walk**: To reconstruct context for an LLM call, walk the `parent_entry_id`
chain starting from `Session.leaf_entry_id`, collecting up to `LLM_HISTORY_TURNS` entries.
This replaces the previous timestamp-sort approach and correctly handles branches.

---

## Existing nodes (pre-session)

These nodes were defined before the Session schema. They remain valid and are not
migrated — history built with them has no `parent_entry_id` chain.

| `@type`       | Purpose                              | Key fields                                      |
|---------------|--------------------------------------|-------------------------------------------------|
| `UserPrompt`  | Raw prompt from the user             | `content`, `timestamp_ns`                       |
| `AgentResponse` | LLM response                       | `prompt_ref`, `content`, `tool_calls`, `llm.*`  |
| `UsageRecord` | Token / cost record per LLM call     | `provider`, `tokens_in`, `tokens_out`, `estimated_usd` |
| `RefarmConfig`| `.refarm/config.json` snapshot       | `provider`, `model`, `stream_responses`, `budgets` |
