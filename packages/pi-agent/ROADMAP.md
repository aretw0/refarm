# pi-agent — Roadmap

**Current Version**: v0.1.0-dev  
**Future name**: `farmhand` — thematic with tractor, barn, silo, creek, sower  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## Philosophy

> Minimal primitives. Total extensibility. CRDT as the source of truth.

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
- [ ] `tractor-native prompt --agent pi-agent "do something"` subcommand
  - Connects to a running daemon on `--port 42000`, sends `user:prompt`, streams back `AgentResponse` content
  - Implementation: `tokio-tungstenite` client in `main.rs` behind `clap` subcommand
  - If no daemon running: start ephemeral tractor in same process, load plugin, respond, exit
- [ ] `tractor-native watch` — interactive REPL loop: reads stdin line-by-line, prints responses
  - Same ephemeral-or-connect logic as `prompt`
  - Stateful: CRDT accumulates across turns → conversational memory works without extra config

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
- [x] `LLM_TOOL_OUTPUT_MAX_LINES` — squeez pipeline: strip ANSI → dedup → truncate
- [x] ANSI stripping, consecutive line dedup, cross-call FNV-1a dedup
- [x] `search_files` — grep: `{pattern, path, glob?}` → `file:line` matches via `bash grep -rn`; exit 1 with no output → friendly "no matches" message
- [x] `LLM_TOOL_OUTPUT_MAX_LINES` harness scenario: assert truncation header in AgentResponse tool_calls

### Harness expansion
- [x] Tool use scenario: mock sequence (tool_call → final text), assert `tool_calls` logged
- [x] Fallback scenario: anthropic fails → ollama mock serves
- [x] Multi-turn scenario: `LLM_HISTORY_TURNS=2`, capturing mock asserts prior turns in request
- [x] `.refarm/config.json` scenario: write config to temp dir, assert `LLM_PROVIDER` injected into plugin

---

## v0.3.0 — Ecosystem integration

**Scope**: refarm-stack compatibility, distro enablement, multi-agent coordination.

### refarm-stack (agents-lab)
- [ ] `refarm-stack` package in `aretw0/agents-lab` uses farmhand as engine
- [ ] Porting pi-stack behaviors to Refarm CRDT primitives with minimal friction
- [ ] Validate that distros (`.dev`, `.me`, `.social`) can compose farmhand without core changes
- [x] Contract: farmhand exposes no domain opinion — distros provide system prompts via `LLM_SYSTEM` env var

### Multi-agent (swarm)
- [ ] Multiple farmhand instances in the same tractor process
- [ ] Cross-agent coordination via CRDT: agent B reads agent A's `AgentResponse` nodes
- [ ] `LLM_AGENT_ID` — namespaces CRDT nodes per agent (`urn:farmhand:<id>:resp-<seq>`)
  - Implementation: prefix `new_id()` namespace; `query_nodes` filter by `@id` prefix
- [ ] Swarm harness scenario: two plugins, agent B queries agent A's output

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
