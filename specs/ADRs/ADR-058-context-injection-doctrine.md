# ADR-058: Context Injection Doctrine for Refarm Agents

**Status**: Accepted  
**Date**: 2026-05-03  
**Author**: Arthur Silva  
**Influences**: [Pi-mono](https://github.com/badlogic/pi-mono), [Squeez](https://github.com/claudioemmanuel/squeez)

---

## Context

As the Refarm agent system (pi-agent, context-provider-v1) matures into a daily-driver tool,
token footprint becomes a first-class concern. Each prompt execution has a direct cost in
latency, money, and context budget. Without doctrine, context providers drift toward dumping
full content into system prompts — making the agent slower, more expensive, and eventually
non-functional at the context window boundary.

Research into Pi-mono and Squeez identified two orthogonal strategies:

- **Pi-mono**: Inject pointers, not content. Skills are `<name, description, location>` only;
  content is demand-loaded via `read`. The system prompt stays O(1) regardless of how many
  capabilities are registered.

- **Squeez**: Enforce budgets before execution, not after. `PreToolUse` injects `limit`/`max_results`
  into tool inputs before the tool runs. The model never sees the unconstrained output.

These are not competing strategies — they operate at different layers and compose cleanly.

---

## Decision

The Refarm agent system adopts three binding principles for all context injection:

### Principle 1 — Pointer-First

Context providers MUST inject references (URNs, file paths, structured digests), not full
content. Full content is fetched by the agent on demand via tool calls (`read_file`,
`task_status`, `list_tasks`, etc.).

**Allowed in system prompt:**
```
# Recent agent sessions (last 3)
- urn:refarm:session:v1:abc → 12 tasks done (2026-05-02)
- urn:refarm:session:v1:def → 3 tasks, 1 failed (2026-05-01)
Current: urn:refarm:session:v1:xyz
```

**Not allowed in system prompt:**
```
# Task detail
Title: Implement storage adapter
Status: done
Created: 2026-05-02T14:32:11Z
Events:
  - created by urn:refarm:agent:pi-agent at 14:32:11
  - status_changed to done at 14:45:03
  ...
```

### Principle 2 — Pre-Tool Budget Enforcement

Tool inputs MUST have default limits injected before dispatch when the model has not
specified them. This is enforced at the tool dispatch layer, not at the output compression
layer. Output compression (ANSI strip, dedup, truncation) is a secondary safety net.

Default budgets (overridable per-call by the model):
- `read_file`: `limit=300` lines (expandable via `offset` for paging)
- `search_files`: `max_results=100` matches
- `list_tasks`: `limit=20` (already enforced in the tool itself)

The feature is controlled by the `LLM_PRE_TOOL_BUDGET` environment variable:
- Unset or `1`/`true`/`yes`/`on` → enforcement active (default)
- `0`/`false`/`no`/`off` → pass-through mode (for debugging)

### Principle 3 — Three Distinct Injection Moments

Context injection MUST be classified into one of three moments:

| Moment | When | What | Example |
|---|---|---|---|
| `session_start` | Once per session, before first user turn | Static capabilities, session URN digest, persona | Skills, session history digest, date/cwd |
| `pre_tool` | Before each tool call | Input rewriting, limit injection | `limit`/`max_results` defaults |
| `on_overflow` | When context budget is exhausted | Compaction trigger, structured summary | Summary schema (Goal/Progress/Next Steps) |

Mixing these moments creates unpredictable token behavior. A provider that re-runs at
`pre_tool` time but was designed for `session_start` will inflate costs proportionally to
the number of tool calls.

---

## Token Tracking

Every tool call result that is returned to the model MUST include a machine-readable header
when truncation was applied:

```
[truncated: 842 lines → first 300 shown; use read_file with offset=300 to continue]
```

This gives the model an explicit continuation path without requiring it to guess. The header
format is stable and parseable by tooling that tracks token usage trends.

Providers that reject content (e.g., file too large, no matches) MUST emit a short
explanation, not an empty string:

```
[no matches for 'pattern' in /path]
[read_file: 0 bytes in /path]
```

---

## Token Budget Philosophy

The agent is designed to be *lean by default and extensible by extension*. This mirrors
Pi-mono's approach: the core agent does as little as possible; extensions add capability
without polluting the default footprint.

This means:
- The default system prompt MUST fit in under 2 KB of text before context providers add entries
- Each context provider MUST declare its worst-case token contribution in its docstring
- New context providers start as extensions; only those that prove essential across multiple
  work profiles graduate to being loaded by default

As the LLM model changes (different context windows, different cost structures), providers
may be promoted or demoted without changing the agent's core behavior.

---

## Consequences

**Positive:**
- System prompt token footprint stays bounded and predictable
- `read_file` becomes pageable — long files no longer silently lose content at the end
- Budget enforcement is auditable via `LLM_PRE_TOOL_BUDGET=0` passthrough mode
- Extensions can improve context quality without changing core behavior

**Negative:**
- Agents using pointer-first context need more round-trips (one extra tool call to expand)
- Pre-tool limit injection can frustrate debugging if the agent hits a limit without knowing
  it needs to page — mitigated by the truncation header with explicit continuation path

---

## Related

- ADR-053: Host-proxied LLM streaming
- ADR-057: Task/session contracts
- ADR-044: WASM plugin loading (Barn)
- `packages/pi-agent/src/compress.rs` — existing post-output compression (secondary safety net)
- `packages/context-provider-v1/` — session-start providers
