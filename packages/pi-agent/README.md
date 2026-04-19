# pi-agent

Sovereign AI coding agent — WASM plugin for the Refarm Tractor.

Inspired by [Pi](https://github.com/kaleidawave/pi) but differentiated by the Refarm primitives:
**CRDT-backed state** (every action is auditable and replicable) and the **WASM Component Model**
(sandboxed, capability-gated, composable). Runs on x86 servers, Raspberry Pi edge nodes, and
anywhere `tractor` is deployed.

> Future name: **farmhand** — the worker of the tractor, native to the Refarm ecosystem.

---

## What it does

Responds to `user:prompt` events via any LLM provider and persists results in the CRDT:

```
on-event("user:prompt", prompt)
  → guard: LLM_MAX_CONTEXT_TOKENS          — blocks oversized prompts before any API call
  → guard: LLM_BUDGET_<PROVIDER>_USD       — rolling 30-day spend cap per provider
  → history: LLM_HISTORY_TURNS             — opt-in conversational memory from CRDT
  → provider::complete()                   — Anthropic or OpenAI-compat wire format
    → agentic tool loop (up to LLM_TOOL_CALL_MAX_ITER)
      → read_file / write_file / edit_file (agent-fs)
      → list_dir (agent-shell: ls -1)
      → bash (agent-shell, structured argv — no shell injection)
      → compress_tool_output() (opt-in via LLM_TOOL_OUTPUT_MAX_LINES)
  → on error / budget block: LLM_FALLBACK_PROVIDER
  → store AgentResponse node  (content, tool_calls, timestamp_ns)
  → store UsageRecord node    (tokens, estimated_usd, usage_raw, provider)
```

---

## Environment variables

Variables are injected via `inherit_env()` in the tractor host. A `.refarm/config.json` file
at project root can set them declaratively — values there override process env:

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "default_provider": "ollama",
  "budgets": { "anthropic": 5.0 }
}
```

The file is optional — missing file is silently ignored.

<!-- {=config_fields} -->
| Field | Maps to | Description |
|---|---|---|
| `provider` | `LLM_PROVIDER` | Active provider for this project |
| `model` | `LLM_MODEL` | Model ID override |
| `default_provider` | `LLM_DEFAULT_PROVIDER` | Sovereign default when provider unset |
| `budgets.<provider>` | `LLM_BUDGET_<PROVIDER>_USD` | Rolling 30-day spend cap in USD |
<!-- {/config_fields} -->

<!-- {=env_vars} -->
| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | — | `anthropic` \| `ollama` \| `openai` \| any OpenAI-compat name |
| `LLM_DEFAULT_PROVIDER` | — | Personal sovereign default when `LLM_PROVIDER` unset |
| `LLM_MODEL` | provider default | Model ID override |
| `LLM_BASE_URL` | provider default | Base URL override (required for custom OpenAI-compat) |
| `ANTHROPIC_API_KEY` | — | Required when `LLM_PROVIDER=anthropic` |
| `OPENAI_API_KEY` | — | Required when `LLM_PROVIDER=openai` |
| `LLM_MAX_CONTEXT_TOKENS` | unlimited | Block prompts estimated above this token count |
| `LLM_FALLBACK_PROVIDER` | — | Retry with this provider on primary error or budget block |
| `LLM_BUDGET_<PROVIDER>_USD` | unlimited | Rolling 30-day cap, e.g. `LLM_BUDGET_ANTHROPIC_USD=5.0` |
| `LLM_HISTORY_TURNS` | `0` (disabled) | Conversational memory depth from CRDT — opt-in |
| `LLM_TOOL_CALL_MAX_ITER` | `5` | Max agentic tool loop iterations per prompt |
| `LLM_TOOL_OUTPUT_MAX_LINES` | unlimited | Truncate tool output at N lines before feeding back to LLM; pipeline: strip ANSI → dedup → truncate |
| `LLM_SYSTEM` | built-in default | System prompt override — distros and stacks inject persona/role here without recompiling |
<!-- {/env_vars} -->

**Provider resolution order** (first wins):
1. `LLM_PROVIDER` — explicit per-run choice
2. `LLM_DEFAULT_PROVIDER` — user's personal sovereign default
3. `ollama` — last resort: local, free, no key needed

**Any unknown provider name** routes to the OpenAI-compat path via `LLM_BASE_URL` —
Groq, Mistral, Perplexity, Together, etc. all work with zero code changes.

---

## Build

```bash
# WASM component (required for running inside tractor)
cargo component build --release

# Output
target/wasm32-wasip1/release/pi_agent.wasm
```

Requires [`cargo-component`](https://github.com/bytecodealliance/cargo-component).

---

## Test

```bash
# Native unit tests (pure logic, no WASM required)
cargo test

# WASM integration harness (real plugin, mock LLM server, real CRDT)
# Run in packages/tractor:
cargo component build --release -p pi-agent   # build WASM first
cargo test --test pi_agent_harness -- --ignored --test-threads=1
```

The harness loads the real `pi_agent.wasm` via `PluginHost`, mocks only the LLM HTTP boundary
with a pre-scripted TCP server, and asserts on what the plugin stores in the CRDT.
This is the "let the plugin be the plugin" model from
[pi-test-harness](https://github.com/marcfargas/pi-test-harness).

---

## Architecture

### Provider abstraction

`Provider::from_env()` selects the implementation at runtime. Adding a new OpenAI-compat
provider requires zero code: set `LLM_PROVIDER=groq` + `LLM_BASE_URL=https://api.groq.com`.

```
Anthropic ──┐
OpenAI ─────┼── Provider::complete(system, messages[]) ── agentic tool loop
Ollama ─────┤
<any> ──────┘  (OpenAI-compat path)
```

### Agentic tool loop

The loop runs inside each provider's wire format handler (format-aware per provider):

```
messages → LLM request → tool_calls? → dispatch(agent_fs | agent_shell) → append result → repeat
                       → text? → return CompletionResult
```

Tool calls are logged in `CompletionResult.tool_calls` and stored in `AgentResponse.tool_calls`
in the CRDT for full audit.

### CRDT as state

Every action writes to the CRDT via `tractor_bridge::store_node`. Nothing is ephemeral:

| Node type | Written when |
|---|---|
| `UserPrompt` | Prompt received |
| `AgentResponse` | LLM response complete (includes `tool_calls` log) |
| `UsageRecord` | After every response (tokens, cost, provider, `usage_raw`) |

### Available tools

<!-- {=tools} -->
| Tool | Source | Description |
|---|---|---|
| `read_file` | agent-fs | Read file contents at absolute path |
| `write_file` | agent-fs | Write UTF-8 content to file atomically |
| `edit_file` | agent-fs read+write | Multi-edit: `{path, edits:[{old_str,new_str}]}` — exact match required, ambiguous matches rejected |
| `list_dir` | agent-shell (ls) | List files and directories at a path |
| `search_files` | agent-shell (grep) | Search for regex pattern in files; optional `glob` filter; returns `file:line` matches |
| `bash` | agent-shell | Run command via structured argv — no shell injection |
<!-- {/tools} -->

`query_nodes("UsageRecord", limit)` powers the rolling budget check.
`query_nodes("UserPrompt" / "AgentResponse", limit)` powers conversational history.

### Extensibility axioms

Four axioms are enforced as named tests in `extensibility_contract`:

- **A1** Any unknown provider name works via OpenAI compat — no code change
- **A2** Zero env vars → agent boots and responds
- **A3** `LLM_HISTORY_TURNS` absent/0 → no CRDT reads for context
- **A4** No `LLM_BUDGET_*` → no budget blocking

---

## WIT interfaces

```wit
world pi-agent {
    import tractor-bridge;   // store_node, query_nodes, get_node
    import agent-fs;         // read, write, edit
    import agent-shell;      // spawn (structured argv, no shell injection)
    export integration;      // setup, on_event, metadata, …
}
```

Defined in `wit/world.wit`. Host implementations are in `packages/tractor/src/host/`.

---

## Related

- [`tractor`](../tractor) — the daemon that loads and runs this plugin
- [`barn`](../barn) — plugin lifecycle and SHA-256 integrity
- [AGENTS.md](../../AGENTS.md) — rules of engagement for AI agents in this repo
- [pi-test-harness](https://github.com/marcfargas/pi-test-harness) — test harness inspiration
- [Pi](https://github.com/kaleidawave/pi) — the coding agent this was inspired by
