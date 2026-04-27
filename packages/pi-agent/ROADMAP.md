# pi-agent — Roadmap

**Current Version**: v0.1.0-dev  
**Future name**: `farmhand` — thematic with tractor, barn, silo, creek, sower  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## Philosophy

> Minimal primitives. Total extensibility. CRDT as the source of truth.

**Critical guardrail**: avoid shipping behavior that is specific to a single coding-agent persona when it can be a host/tool primitive shared by any plugin.
Farmhand should consume generic primitives; it should not become the place where generic platform logic gets trapped.

pi-agent learns from [Pi](https://github.com/kaleidawave/pi) but is not Pi:
- Pi has ephemeral session state. pi-agent has **CRDT-backed state** — auditable, replicable, queryable.
- Pi is a CLI tool. pi-agent is a **WASM plugin** — sandboxed, composable, deployable anywhere tractor runs.
- Pi has hardcoded context strategies. pi-agent has **opt-in everything** — env vars drive all behavior.

Context engineering follows the pi-test-harness model:
"let the plugin be the plugin" — test real WASM, mock only the LLM boundary.

---

## v0.1.0 — Foundation (DONE ✅)

### WASM scaffold + event pipeline
- [x] `cargo component build` producing valid `pi_agent.wasm`
- [x] `on_event("user:prompt")` → `store AgentResponse` pipeline
- [x] `UserPrompt` + `AgentResponse` nodes in CRDT with `timestamp_ns`

### Multi-provider LLM (2C.1)
- [x] Anthropic (`/v1/messages`) and OpenAI-compat (`/v1/chat/completions`) wire formats
- [x] Provider selection: `LLM_PROVIDER` → `LLM_DEFAULT_PROVIDER` → `ollama` (sovereign default)
- [x] Any unknown provider name routes to OpenAI-compat path — zero code for Groq, Mistral, etc.

### Usage tracking (2D)
- [x] `UsageRecord` CRDT node: `tokens_in`, `tokens_out`, `tokens_cached`, `tokens_reasoning`, `estimated_usd`, `usage_raw`
- [x] Cache discount pricing (cached tokens at ~10% of normal rate)
- [x] `usage_raw` preserves full provider usage object for audit — never normalized away

### Guards and resilience (2D-ext, 2D-ext2)
- [x] `LLM_MAX_CONTEXT_TOKENS` — blocks oversized prompts before any API call
- [x] `LLM_FALLBACK_PROVIDER` — automatic retry on primary provider error

### Provider sovereignty (feat)
- [x] Invert default: Anthropic is explicit-only, Ollama is the last-resort sovereign default
- [x] `LLM_DEFAULT_PROVIDER` — user configures their own floor without touching `LLM_PROVIDER`

### Budget check (2E)
- [x] `sum_provider_spend_usd()` — pure function, reads `UsageRecord` CRDT nodes
- [x] Rolling 30-day window via `timestamp_ns`
- [x] `LLM_BUDGET_<PROVIDER>_USD` — opt-in cap per provider
- [x] Budget block feeds into `LLM_FALLBACK_PROVIDER` path — zero extra code

### Conversational memory (2F)
- [x] `history_from_nodes()` — pure function, sorts by `timestamp_ns`, caps at `max_turns`
- [x] `LLM_HISTORY_TURNS` — opt-in (default 0 = disabled), Pi-aligned: no silent CRDT reads
- [x] `Provider::complete()` accepts full messages slice — multi-turn wire format for both providers

### Agentic tool use
- [x] `dispatch_tool()` — `read_file`, `write_file`, `bash` via `agent_fs`/`agent_shell` WIT imports
- [x] Full agentic loop inside each provider (format-aware): tool_use blocks → dispatch → next request
- [x] `LLM_TOOL_CALL_MAX_ITER` — configurable loop cap (default 5)
- [x] Tool calls logged in `CompletionResult.tool_calls` → stored in `AgentResponse.tool_calls` CRDT

### Extensibility contract
- [x] `extensibility_contract` test module: axioms A1–A4 as named executable guarantees
- [x] A1: unknown provider → OpenAI compat; A2: zero-config boot; A3: context opt-in; A4: budget opt-in

### Internal modularity (maintainability)
- [x] Split monolithic `lib.rs` into runtime/provider/tool/session/structured modules
- [x] Split provider engine into `provider_anthropic.rs` and `provider_openai_compat.rs`
- [x] Extract shared provider-loop helpers into `provider_runtime.rs` (headers/path/body builders, per-iteration request executors + response parse/extractors, generic response+phase primitive + iteration response+phase helpers, iteration-phase parsers, loop-state/loop-plan builders, common runner config + provider runner configs + config-driven runners, common-config loop orchestration primitives (including context-driven dispatch), state-bound response+phase + step-dispatch primitives, iteration-contract step primitive, state-primitives loop orchestration (common-config + context; dispatch + non-dispatch), generic usage-ingest primitive + generic phase-after-usage primitive + usage+phase combiners, initial wire-message builders, response-usage/finalization helpers, completion content guards + termination gate helpers, provider-specific completion gates, generic step terminate/advance primitive + step-level terminate/advance helpers, generic loop orchestrator + plan-driven orchestration + loop outcomes, dispatch-injectable loop orchestration + shared wasm loop executor, wasm loop runners, generic tool executor + generic tool-phase pipeline primitive + tool-phase executors/recorders + phase advancement helpers, loop termination, error extraction, wire-message appenders, dispatch+dedup primitive, argument parse, usage aggregation, executed-call shape)
- [x] Extract pure provider defaults/model-selection helpers (`provider_config.rs`)
- [x] Add explicit provider factory (`Provider::from_provider_name`) to avoid env mutation in fallback routing
- [x] Extract CRDT response node builders (`response_nodes.rs`) for reusable schema-safe writes
- [x] Split tool dispatch into domain modules (`tool_dispatch/fs_shell.rs`, `session_tools.rs`, `code_ops_tools.rs`)
- [x] Further split fs/shell/structured tool handlers into focused modules (`tool_dispatch/fs_tools.rs`, `shell_tools.rs`, `structured_tools.rs`)
- [x] Split runtime module into react loop + prompt handler (`runtime/react_loop.rs`, `runtime/prompt_handler.rs`)
- [x] Split runtime flow by target boundary (`runtime/wasm_flow.rs`, `runtime/native_stub.rs`) while keeping `react_loop.rs` orchestration-thin
- [x] Extract prompt/session persistence side-effects from handler into `runtime/prompt_persistence.rs`
- [x] Split session module into pure primitives + wasm-only ops (`session/pure.rs`, `session/wasm_ops.rs`)
- [x] Move large unit suites out of `lib.rs` into `tests.rs` + `extensibility_contract.rs`
- [x] Split `tests.rs` into domain submodules under `src/tests/` (compress, session, structured_io, provider/env, tools, usage, response nodes)

### WASM integration harness (`packages/tractor/tests/pi_agent_harness.rs`)
- [x] Real `pi_agent.wasm` loaded via `PluginHost` (not a stub)
- [x] Mock LLM: `TcpListener::bind(":0")` returns scripted OpenAI-compat JSON
- [x] 4 scenarios: AgentResponse stored, UsageRecord tokens, context guard, budget block
- [x] `ENV_LOCK` Mutex prevents env var cross-contamination between parallel tests

---

## v0.2.0 — Farmhand graduation

**Scope**: Rename, streaming, project-level config, expanded tooling, daily-driver CLI.

### Naming
- [ ] Rename package `pi-agent` → `farmhand`
- [ ] Update `Cargo.toml`, `wit/world.wit` world name, tractor fixture references
- [ ] Update README, this ROADMAP, and any cross-package references

### Daily-driver CLI
> Inspired by Pi CLI and Claude Code: invoke the agent from a terminal without a WebSocket client.
- [x] `tractor prompt --agent pi-agent "do something"` subcommand
- [x] `tractor watch` — polling loop for AgentResponse nodes
- [x] `tractor query --type <T> --namespace <N>` — read CRDT nodes from local storage (no daemon)
- [x] `tractor store-node --payload <JSON>` — store raw CRDT node (no daemon)
- [x] `npm run agent:daemon` — start tractor in background with PID file
- [x] `npm run agent:stop` — graceful stop via PID file
- [x] `npm run agent:status` — health check: daemon, keys, WASM age, LLM config, LLM_FS_ROOT safety
- [x] `npm run agent:repl` — interactive multi-turn REPL with history, `/tree`, `/sessions`, `/fork`, `/navigate`
  - ANSI stripping + 200-line output truncation per response
  - Soft rate limit warning from CRDT UsageRecord nodes (yellow >20/h, red >40/h)
  - `/fork [name]` — branch current session at leaf, writes to CRDT directly
  - `/navigate <entry_id>` — move session pointer, writes to CRDT directly

### Streaming token output
- [ ] Stream LLM tokens to WebSocket clients as they arrive (partial `AgentResponse` nodes)
- [ ] `is_final: false` intermediate nodes, `is_final: true` on completion
- [ ] Requires chunked HTTP read in `wasi::http` outgoing handler — no host changes needed
- [ ] Wire format: server-sent events in `AgentResponse.content` chunks, reassembled by client

### `.refarm/` project convention
- [x] Read `.refarm/config.json` in tractor before spawning plugin — maps to env vars
- [x] `config.json` fields: `provider`, `model`, `default_provider`, `budgets`
- [x] Implementation seam: `refarm_config_env_vars_from()` → `WasiCtxBuilder::envs()` — config overrides process env
- [x] CRDT-backed: config itself is a `RefarmConfig` node — auditable, collaborative
  - `tractor_bridge::store_node` on load; `query_nodes("RefarmConfig", 1)` to read back
  - Zero new architecture: same store/query primitives already used by UsageRecord

### Expanded tools
- [x] `edit_file` — multi-edit: `{path, edits:[{old_str,new_str}]}` (mitsuhiko pattern, agents-lab curated)
- [x] `list_dir` — directory listing via `bash ls -1`
- [x] `search_files` — grep: `{pattern, path, glob?}` → `file:line` matches
- [x] `LLM_TOOL_OUTPUT_MAX_LINES` — squeeze pipeline: strip ANSI → dedup → truncate
- [x] `read_structured` — parse JSON/TOML/YAML with `page_size`/`page_offset` pagination
- [x] `write_structured` — validate JSON/TOML/YAML then write atomically (rejects invalid before touching file)
- [x] `list_sessions` / `current_session` — LLM can inspect its own session tree
- [x] `navigate` / `fork` — LLM can rewind and branch its own conversation

### Harness expansion
- [x] Tool use scenario: mock sequence (tool_call → final text), assert `tool_calls` logged
- [x] Fallback scenario: anthropic fails → ollama mock serves
- [x] Multi-turn scenario: `LLM_HISTORY_TURNS=2`, capturing mock asserts prior turns in request
- [x] `.refarm/config.json` scenario: write config to temp dir, assert `LLM_PROVIDER` injected into plugin
- [x] Session wiring scenario: two prompts → leaf_entry_id advances, SessionEntry count grows
- [x] write_structured scenario: mock tool call → file created on disk with valid JSON
- [x] read_structured scenario: mock tool call → pagination header in tool result
- [x] LLM_AGENT_ID scenario: all new_id() nodes carry `urn:farmhand:<id>:` prefix

---

## v0.3.0 — Ecosystem integration

**Scope**: refarm-stack compatibility, distro enablement, multi-agent coordination, semantic code tools.

### Structured I/O tools (`structured-io`) ✅ DONE
> REQ-AGENT-001 — T-NEXT-266/268/275/278/284

- [x] `read_structured` pi-agent tool: JSON/TOML/YAML with `page_size`/`page_offset` (T-NEXT-268/275)
- [x] `write_structured` pi-agent tool: validate-before-write for all three formats (T-NEXT-278)
- [x] `structured-io` WIT interface in `agent-tools/wit/world.wit` (T-NEXT-284)
  - `read-structured` and `write-structured` exported from `agent-tools-provider` world
  - Shared layer: any plugin or host-facing tool imports without duplicating parse logic
- [x] 93 unit tests total across formats, pagination, and validation paths
- [x] `structured-io` imported in pi-agent WIT world — wasm32 dispatch delegates to WIT import, no duplication (T-NEXT-287)
  - Host-side `StructuredIoHost` implemented natively in `TractorNativeBindings`
  - Pre-existing wasm32 compile errors in session management code fixed as part of same slice

### Semantic code operations (`code-ops`)
> REQ-AGENT-002 — T-NEXT-267/268

Instead of asking the agent to "replace all occurrences of X" (fragile, misses imports, breaks across modules), expose LSP-backed operations as host-provided WIT imports. The host (tractor) manages the LSP server process; the plugin calls clean primitives.

**Integration approach**: subprocess (not in-process, not MCP)
- Tractor spawns `rust-analyzer` / `typescript-language-server` on demand via `tokio::process`
- Communicates over stdin/stdout JSON-RPC (LSP spec) — no extra dep, works offline
- LSP server lifetime tied to tractor process; plugin calls are synchronous from plugin POV
- MCP is considered an extension point for future IDE integration, not the primary path

**WIT interface sketch** (`interface code-ops` in `refarm-plugin-host.wit`):
```wit
interface code-ops {
    record symbol-location {
        file: string,
        line: u32,
        column: u32,
    }

    record reference {
        file: string,
        line: u32,
        column: u32,
        kind: string,   // "definition" | "reference" | "implementation"
    }

    record rename-result {
        files-changed: u32,
        edits-applied: u32,
    }

    /// Rename symbol at location across entire project (LSP workspace/rename).
    rename-symbol:   func(loc: symbol-location, new-name: string) -> result<rename-result, string>;

    /// Find all references to symbol at location (LSP textDocument/references).
    find-references: func(loc: symbol-location) -> result<list<reference>, string>;

    /// Move a top-level item to another file (LSP workspace edit — language-server-dependent).
    move-symbol:     func(loc: symbol-location, target-file: string) -> result<_, string>;
}
```

**Open questions before implementation**:
- Which LSP servers to ship first? rust-analyzer (already used by devcontainer) is the natural v1.
- `move-symbol` is not standard LSP — needs `workspace/applyEdit` workaround per server.
- Should operations be atomic (backup + rollback on partial failure)?

**Dependency**: agent-tools package (T-NEXT-268) should exist before this is wired.

- [x] Add `code-ops` interface to `refarm-plugin-host.wit` (T-NEXT-289)
  - `symbol-location`, `code-reference`, `rename-result` records; `rename-symbol` and `find-references` funcs
- [x] Add to pi-agent as tools: `rename_symbol(file, line, col, new_name)`, `find_references(file, line, col)` (T-NEXT-289)
  - Dispatch arms call WIT import; 97 tests pass (4 new schema+required-fields tests)
- [x] Stub host in `TractorNativeBindings`: returns "lsp not connected" until LSP bridge is built (T-NEXT-289)
- [ ] Implement tractor-side LSP subprocess manager (`packages/tractor/src/host/lsp_bridge.rs`)
- [ ] Expose `rename-symbol` and `find-references` for rust-analyzer as v1
- [ ] Integration test: rename a Rust symbol via pi-agent, assert all references updated

### refarm-stack (agents-lab)
- [ ] `refarm-stack` package in `aretw0/agents-lab` uses farmhand as engine
- [ ] Porting pi-stack behaviors to Refarm CRDT primitives with minimal friction
- [ ] Validate that distros (`.dev`, `.me`, `.social`) can compose farmhand without core changes
- [x] Contract: farmhand exposes no domain opinion — distros provide system prompts via `LLM_SYSTEM` env var

### Generalization backlog (cross-plugin primitives first)

> Rule: when logic can be expressed once in host/shared tools and reused by many plugins, prefer that over pi-agent-only implementation.

- [ ] Promote `provider_config` defaults mapping into a shared host/plugin utility surface (so non-coding agents reuse the same routing defaults)
- [ ] Promote URN builder convention (`new_pi_urn`-style) into a cross-plugin ID primitive with configurable namespace prefix
- [ ] Evaluate moving generic tool-dispatch families (`fs/shell/session/code-ops`) into reusable shared dispatch helpers in `agent-tools`
- [ ] Evaluate unifying public tool API into mode-aware core calls (`read/write/edit` + `mode=plain|structured|ast`) while keeping compatibility aliases to reduce LLM tool/schema context
- [ ] Extract response-node builders into generic CRDT schema helpers (typed builders for common node metadata/timestamps)
- [ ] Add an architectural check in reviews: "is this logic farmhand-specific or platform-primitive?" and reject plugin-local platform logic

### Multi-agent (swarm)
- [x] `LLM_AGENT_ID` — namespaces CRDT nodes per agent (`urn:farmhand:<id>:<hex>`) (T-NEXT-282)
  - `new_id()` prefixes with agent namespace when `LLM_AGENT_ID` is set; backward-compatible
  - A5 extensibility axiom: 3 tests covering absent/set/uniqueness cases
  - Harness scenario verifying Session/SessionEntry @id carry agent namespace (T-NEXT-283)
- [x] Multiple farmhand instances in the same tractor process — demonstrated in swarm harness (T-NEXT-290)
- [x] Cross-agent coordination via CRDT: agent B reads agent A's `AgentResponse` nodes (T-NEXT-290)
  - `harness_swarm_agent_b_reads_agent_a_crdt_nodes`: two agents share one `NativeSync`, B sees A's namespaced nodes
  - Coordination is intentionally read-unrestricted: isolation is ID-based (URN prefix), not access-gated
- [ ] A2A (Agent-to-Agent) protocol research — evaluate Google A2A, MCP, JSON-LD native patterns
  - Goal: primitives that let farmhand participate in multi-agent networks without runtime coupling
  - CRDT store is already the natural rendezvous; question is routing and schema conventions
- [ ] Swarm harness: agent B uses LLM to formulate a query based on agent A's output (full reasoning loop)

### Zig Pi-Nano host
- [ ] Minimal Zig host that loads `farmhand.wasm` — no Rust runtime
- [ ] Targets RPi Zero / microcontrollers
- [ ] WIT subset: `tractor-bridge` (store/query), `agent-fs` — no `agent-shell`
- [ ] Storage: SQLite via Zig `sqlite` bindings (same schema as tractor's `NativeStorage`)
- [ ] First milestone: `on_event("user:prompt", "hello")` stores `AgentResponse` — no LLM call needed

---

## Tooling notes

### mdt (documentation sync)
[mdt](https://github.com/ifiokjr/mdt) — template-based markdown sync with `mdt check` for CI.

**What to commit vs ignore:**
- ✅ Commit: `.templates/*.t.md` (providers — canonical source)
- ✅ Commit: `README.md`, any file with `{=block}` markers (consumers — managed content)
- ✅ Commit: `mdt.toml` (config)
- ❌ Ignore: `.mdt/` (scan cache — regenerated on every mdt run, added to `.gitignore`)

**Blocks in this package:**
- `env_vars` — LLM_* environment variables table → `README.md`
- `tools` — available agent tools table → `README.md`
- `config_fields` — `.refarm/config.json` field mapping → `README.md`

- [x] `.templates/template.t.md` — canonical source for `env_vars`, `tools`, `config_fields`
- [x] `mdt.toml` scaffolded
- [x] `README.md` wired with all three block markers
- [x] `mdt check` in CI — `.github/workflows/validate-mdt.yml`, cached `mdt_cli`, scheduled weekly
- [x] `.mdt/` added to `.gitignore`
- [ ] Expand to monorepo root when a cross-package consumer exists (e.g. distro docs referencing `env_vars`)

### Diagram library
Keep architecture diagrams in sync with implementation. When significant structural changes
land (e.g., farmhand rename, streaming), update diagrams before closing the milestone.

---

## Security roadmap — lessons from Gondolin

> Reference: [earendil-works/gondolin](https://github.com/earendil-works/gondolin)
>
> Gondolin sandboxes AI-generated code in micro-VMs (QEMU/krun) with host-side credential
> injection and network allowlisting. Refarm uses WASM Component Model instead of micro-VMs —
> a capability-gated sandbox — but shares the same threat model for agentic tool use.

### Threat model (current exposure)

| Surface | Today | Risk |
|---|---|---|
| `ANTHROPIC_API_KEY` in env | Host-only (plugin calls `llm-bridge`) | Residual risk only in host process, not in plugin sandbox |
| `agent_shell::spawn` | allowlist-capable (`LLM_SHELL_ALLOWLIST`) | Misconfig/empty policy can still block or allow too much |
| `agent_fs::read/write` | root-capable (`LLM_FS_ROOT`) | Misconfigured root may still expose broad subtree |
| `wasi:http` egress | removed from pi-agent LLM path | Other plugins may still require separate egress policy |

### Mitigations to design (inspired by Gondolin)

- [x] **Credential placeholder injection (phase 1)** — tractor makes the LLM HTTP call on behalf of the plugin
  instead of the plugin calling the provider directly. Plugin receives responses, never API keys.
  Gondolin calls this "the guest only sees a placeholder token."
  - Implemented WIT import: `llm-bridge::complete-http(provider, base-url, path, headers, body)`
  - `pi-agent` dropped direct `wasi:http` dependency for provider calls and now uses `llm-bridge`
  - Host injects provider auth headers (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) outside plugin sandbox
  - Follow-up: tighten provider/base-url policy centrally in tractor (allowlist/validator)

- [x] **`LLM_SHELL_ALLOWLIST`** — comma-separated list of allowed binaries for `agent_shell::spawn`
  - e.g. `LLM_SHELL_ALLOWLIST=ls,grep,cat,git` — host blocks commands outside allowlist
  - Implemented in `packages/tractor/src/host/agent_tools_bridge.rs`: checks `argv[0]` (basename-aware) before spawn and returns `[blocked: <cmd> not in allowlist]`
  - Semantics: env var **unset** = permissive (backward compatible); env var set empty/whitespace = block all
  - Gondolin equivalent: `allowedHosts` for network; same pattern for commands

- [x] **`LLM_FS_ROOT`** — restrict `agent_fs::read/write` to a subtree
  - e.g. `LLM_FS_ROOT=/workspaces/myproject` — all paths outside rejected at host boundary
  - Implemented in `packages/tractor/src/host/agent_tools_bridge.rs`: enforces guard on `read`, `write`, and `edit`
  - Path policy resolves absolute path against nearest existing ancestor before prefix check; rejects outside paths with `[blocked: path outside LLM_FS_ROOT]`
  - Semantics: env var **unset** = permissive (backward compatible)
  - Gondolin equivalent: VFS mounts with readonly/cow modes

- [x] **`trusted_plugins`** in `.refarm/config.json` — allowlist of plugin IDs that may use agent-shell
  - Implemented in `packages/tractor/src/host/agent_tools_bridge.rs`: `agent-shell::spawn` checks caller `plugin_id` against `trusted_plugins`
  - Semantics: field unset = permissive (backward compatible); set array enforces allowlist; supports `"*"` wildcard
  - Block message: `[blocked: plugin '<id>' not allowed to use agent-shell]`

### WASM vs micro-VM tradeoffs

| Property | WASM Component Model (Refarm) | Micro-VM (Gondolin) |
|---|---|---|
| Memory isolation | ✅ Linear memory, cannot read host | ✅ Full VM boundary |
| Capability gating | ✅ WIT imports are the only API surface | ⚠️  syscall filter (seccomp) |
| `exec` arbitrary code | ⚠️ via `agent_shell::spawn` | ✅ sandboxed inside VM |
| Credential exposure | ⚠️ `inherit_env()` today | ✅ placeholder injection |
| Network egress | ⚠️ unrestricted `wasi:http` | ✅ JS allowlist policy |
| Cold start | ✅ ~ms | ⚠️ ~100ms–1s (VM boot) |

The WASM model wins on cold start and composability. The gap is `agent_shell` and credential handling —
both solvable without moving to micro-VMs.
