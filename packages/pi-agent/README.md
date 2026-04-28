# pi-agent

Sovereign AI coding agent — WASM plugin for the Refarm Tractor.

Inspired by [Pi](https://github.com/kaleidawave/pi) but differentiated by the Refarm primitives:
**CRDT-backed state** (every action is auditable and replicable) and the **WASM Component Model**
(sandboxed, capability-gated, composable). Runs on x86 servers, Raspberry Pi edge nodes, and
anywhere `tractor` is deployed.

Design guardrail: avoid plugin-local logic that should be a general platform primitive. When behavior
is reusable across plugins, it belongs in shared host/tool primitives first, then farmhand consumes it.

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

LLM variables are injected by the tractor host (forwarded `LLM_*` only). A `.refarm/config.json` file
at project root can set them declaratively — values there override process env:

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "default_provider": "ollama",
  "budgets": { "anthropic": 5.0 },
  "trusted_plugins": ["pi_agent"]
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
| `trusted_plugins[]` | (host policy) | Optional allowlist for plugins allowed to use `agent-shell` |
<!-- {/config_fields} -->

<!-- {=env_vars} -->
| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | — | `anthropic` \| `openai` \| `groq` \| `mistral` \| `xai` \| `deepseek` \| `together` \| `openrouter` \| `gemini` \| `ollama` \| any OpenAI-compat name |
| `LLM_DEFAULT_PROVIDER` | — | Personal sovereign default when `LLM_PROVIDER` unset |
| `LLM_MODEL` | provider default | Model ID override |
| `LLM_BASE_URL` | provider default | Base URL override (required for custom OpenAI-compat) |
| `ANTHROPIC_API_KEY` | — | Required when `LLM_PROVIDER=anthropic` |
| `OPENAI_API_KEY` | — | Required when `LLM_PROVIDER=openai`; fallback for unknown compat providers |
| `GROQ_API_KEY` | — | Required when `LLM_PROVIDER=groq` |
| `MISTRAL_API_KEY` | — | Required when `LLM_PROVIDER=mistral` |
| `XAI_API_KEY` | — | Required when `LLM_PROVIDER=xai` |
| `DEEPSEEK_API_KEY` | — | Required when `LLM_PROVIDER=deepseek` |
| `TOGETHER_API_KEY` | — | Required when `LLM_PROVIDER=together` |
| `OPENROUTER_API_KEY` | — | Required when `LLM_PROVIDER=openrouter` |
| `GEMINI_API_KEY` | — | Required when `LLM_PROVIDER=gemini` |
| `LLM_MAX_CONTEXT_TOKENS` | unlimited | Block prompts estimated above this token count |
| `LLM_FALLBACK_PROVIDER` | — | Retry with this provider on primary error or budget block |
| `LLM_BUDGET_<PROVIDER>_USD` | unlimited | Rolling 30-day cap, e.g. `LLM_BUDGET_ANTHROPIC_USD=5.0` |
| `LLM_HISTORY_TURNS` | `0` (disabled) | Conversational memory depth from CRDT — opt-in |
| `LLM_TOOL_CALL_MAX_ITER` | `5` | Max agentic tool loop iterations per prompt |
| `LLM_TOOL_OUTPUT_MAX_LINES` | unlimited | Truncate tool output at N lines before feeding back to LLM; pipeline: strip ANSI → dedup → truncate |
| `LLM_SHELL_ALLOWLIST` | unset (permissive) | Comma-separated allowlist for `agent_shell::spawn`; if set, commands outside list are rejected with `[blocked: <cmd> not in allowlist]` |
| `LLM_FS_ROOT` | unset (permissive) | Restrict `agent_fs::{read,write,edit}` to this subtree; paths outside are rejected with `[blocked: path outside LLM_FS_ROOT]` |
| `LLM_SYSTEM` | built-in default | System prompt override — distros and stacks inject persona/role here without recompiling |
| `LLM_SESSION_ID` | — | Pin the active session by CRDT `@id`; auto-selects most recent session when unset |
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

## Run

After building, start the tractor daemon with pi-agent loaded:

```bash
# From repo root — set your LLM provider via env vars (LLM_* are forwarded to the plugin)
export ANTHROPIC_API_KEY=sk-ant-...           # if using Anthropic
export LLM_PROVIDER=anthropic                 # or: ollama (no key needed, requires local Ollama)
export LLM_MODEL=claude-sonnet-4-6            # optional model override

TRACTOR=packages/tractor/target/release/tractor
WASM=packages/pi-agent/target/wasm32-wasip1/release/pi_agent.wasm

# Start daemon (Ctrl+C to stop)
$TRACTOR --plugin "$WASM" --log-level info

# In a second terminal — send a prompt and wait for response
$TRACTOR prompt --agent pi_agent --payload "list the files in packages/pi-agent/"

# Watch for new responses (polling mode)
$TRACTOR watch
```

**Important**: `--agent` must be `pi_agent` (underscore), matching the `.wasm` filename stem.

**Note on `.refarm/config.json`**: The `provider`/`model` fields there document intent but
LLM routing uses environment variables (`LLM_PROVIDER`, `LLM_MODEL`). Set those before
starting the daemon. The `LLM_FS_ROOT` and `LLM_SHELL_ALLOWLIST` fields ARE loaded from
config.json by the `agent-tools` policy layer.

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

### Source layout (modular primitives)

- `src/lib.rs` — plugin wiring + event entrypoint
- `src/runtime/` — prompt pipeline orchestration split by concern (`react_loop.rs`, `wasm_flow.rs`, `native_stub.rs`, `policy.rs`, `types.rs`, `prompt_handler.rs`, `prompt_persistence.rs`)
- `src/session/` — session primitives split into pure + wasm ops (`pure.rs`, `wasm_ops.rs`)
- `src/provider.rs` — provider selection/facade (`Provider::from_env`, `complete`)
- `src/provider_config.rs` — pure provider defaults/model selection primitives
- `src/provider_anthropic.rs` — Anthropic wire format + agentic loop
- `src/provider_openai_compat.rs` — OpenAI-compatible wire format + agentic loop
- `src/provider_runtime.rs` — provider loop helpers (headers/path/body builders, per-iteration request executors + response parse/extractors, generic response+phase primitive + iteration response+phase helpers, iteration-phase parsers, loop-state/loop-plan builders, common runner config + provider runner configs + config-driven runners, common-config loop orchestration primitives (including context-driven dispatch), state-bound response+phase + step-dispatch primitives, response-phase + iteration-step contract primitives (including contract-native step adapter + contract split helper), physical compactation splits via `provider_runtime/anthropic_phase.rs` + `provider_runtime/anthropic_text.rs` + `provider_runtime/anthropic_tool_uses.rs` + `provider_runtime/iteration_contract.rs` + `provider_runtime/contract_loop.rs` + `provider_runtime/contract_loop_context_tests.rs` + `provider_runtime/contract_loop_nondispatch_tests.rs` + `provider_runtime/state_response_adapter_tests.rs` + `provider_runtime/state_step_adapter_tests.rs` + `provider_runtime/state_loop_context_tests.rs` + `provider_runtime/state_loop_dispatch_tests.rs` + `provider_runtime/state_primitives.rs` + `provider_runtime/loop_dispatch.rs` + `provider_runtime/loop_dispatch_tests.rs` + `provider_runtime/usage_finalize.rs` + `provider_runtime/usage_totals.rs` + `provider_runtime/wasm_anthropic.rs` + `provider_runtime/wasm_loop.rs` + `provider_runtime/wasm_openai.rs` + `provider_runtime/request_headers_anthropic.rs` + `provider_runtime/request_headers_openai.rs` + `provider_runtime/request_headers_common.rs` + `provider_runtime/request_body_anthropic.rs` + `provider_runtime/request_body_openai.rs` + `provider_runtime/request_flow.rs` + `provider_runtime/request_parse.rs` + `provider_runtime/request_path.rs` + `provider_runtime/request_http_wasm.rs` + `provider_runtime/request_anthropic_response_wasm.rs` + `provider_runtime/request_anthropic_wasm.rs` + `provider_runtime/request_openai_response_wasm.rs` + `provider_runtime/request_openai_wasm.rs` + `provider_runtime/wire_bootstrap.rs` + `provider_runtime/phase_common.rs` + `provider_runtime/openai_message.rs` + `provider_runtime/openai_phase.rs` + `provider_runtime/openai_tool_calls.rs` + `provider_runtime/loop_config.rs` + `provider_runtime/loop_limits.rs` + `provider_runtime/loop_state.rs` + `provider_runtime/loop_config_tests.rs` + `provider_runtime/loop_plan_builders.rs` + `provider_runtime/loop_runner_common.rs` + `provider_runtime/loop_runner_types.rs` + `provider_runtime/loop_runner_anthropic.rs` + `provider_runtime/loop_runner_openai.rs` + `provider_runtime/loop_core.rs` + `provider_runtime/output_dedup.rs` + `provider_runtime/output_dedup_wasm.rs` + `provider_runtime/tool_execution.rs` + `provider_runtime/tool_recording.rs` + `provider_runtime/anthropic_tool_phase.rs` + `provider_runtime/openai_tool_phase.rs` + `provider_runtime/tool_phase_common.rs` + `provider_runtime/tool_wire.rs` + `provider_runtime/anthropic_step_phase.rs` + `provider_runtime/openai_step_phase.rs` + `provider_runtime/step_common.rs` + `provider_runtime/usage_extract.rs` + `provider_runtime/usage_phase.rs` + `provider_runtime/usage_phase_common.rs` + `provider_runtime/usage_phase_tests.rs` (behavior-preserving), contract-primitives loop orchestration (common-config + context; dispatch + non-dispatch) + state-primitives loop orchestration (common-config + context; dispatch + non-dispatch) + dispatch/non-dispatch equivalence invariants + max-iter termination equivalence invariants + error-propagation equivalence invariants + no-step-on-response-error invariants, generic usage-ingest primitive + generic phase-after-usage primitive + usage+phase combiners, initial wire-message builders, response-usage/finalization helpers, completion content guards + termination gate helpers, provider-specific completion gates, generic step terminate/advance primitive + step-level terminate/advance helpers, generic loop orchestrator + plan-driven orchestration + loop outcomes, dispatch-injectable loop orchestration + shared wasm loop executor, wasm loop runners, generic tool executor + generic tool-phase pipeline primitive + tool-phase executors/recorders + phase advancement helpers, max iter, loop termination, error extraction, wire-message appenders, dispatch+dedup primitive, argument parse, usage aggregation, executed-call shaping)
- `src/tool_dispatch/` — tool execution bridge split by domain (`fs_shell`, `fs_tools`, `shell_tools`, `structured_tools`, `session_tools`, `code_ops_tools`)
- `src/session/pure.rs`, `src/structured_io.rs`, `src/compress.rs`, `src/utils.rs` — pure primitives
- `src/response_nodes.rs` — CRDT node builders for `UserPrompt`, `AgentResponse`, `UsageRecord`
- `src/tests.rs`, `src/tests/*.rs`, `src/extensibility_contract.rs` — unit + contract tests (domain-sliced)

### Provider abstraction

`Provider::from_env()` selects the implementation at runtime. `Provider::from_provider_name(name)`
allows explicit provider selection (used by fallback flow) without mutating process env.
Adding a new OpenAI-compat provider requires zero code: set `LLM_PROVIDER=groq` +
`LLM_BASE_URL=https://api.groq.com`.

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
| `read_structured` | agent-fs | Parse JSON/TOML/YAML with pagination: `{path, format?, page_size?, page_offset?}` |
| `write_structured` | agent-fs | Validate then write JSON/TOML/YAML atomically — rejects invalid syntax before touching the file |
| `list_sessions` | CRDT | List all conversation sessions with id, name, leaf, and which is active |
| `current_session` | CRDT | Return metadata of the currently active session (id, leaf_entry_id) |
| `navigate` | CRDT | Move session pointer to a specific entry: `{session_id, entry_id}` |
| `fork` | CRDT | Branch a new session from an existing entry: `{session_id, entry_id, name?}` |
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
