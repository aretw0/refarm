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

**Scope**: Rename, streaming, project-level config, expanded tooling.

### Naming
- [ ] Rename package `pi-agent` → `farmhand`
- [ ] Update `Cargo.toml`, `wit/world.wit` world name, tractor fixture references
- [ ] Update README, this ROADMAP, and any cross-package references

### Streaming token output
- [ ] Stream LLM tokens to WebSocket clients as they arrive (partial `AgentResponse` nodes)
- [ ] `is_final: false` intermediate nodes, `is_final: true` on completion
- [ ] Requires host-side streaming support in tractor WebSocket bridge

### `.refarm/` project convention
- [ ] Read `.refarm/config.json` in tractor before spawning plugin — maps to env vars
- [ ] `config.json` fields: `provider`, `model`, `budgets`, `trusted_plugins`
- [ ] CRDT-backed: config itself is a node — collaborative, auditable, self-hosting capable
- [ ] Implementation seam: `.refarm/config.json` → env vars before `WasiCtxBuilder` — zero new architecture

### Expanded tools
- [ ] `edit_file` — unified diff apply via `agent_fs::edit`
- [ ] `list_dir` — directory listing (needs new WIT primitive or `bash ls` workaround)
- [x] `LLM_TOOL_OUTPUT_MAX_LINES` — opt-in truncation with a [truncated: N lines → M shown] header (squeez-inspired)
- [x] ANSI stripping — CSI sequences removed before dedup so color codes don't block line collapse
- [x] Consecutive line dedup — repeated runs of ≥2 identical lines collapsed to `line [×N]`
- [x] Cross-call dedup — FNV-1a hash per tool result; duplicates within a single agentic turn replaced with `[duplicate: ...]`

### Harness expansion
- [x] Tool use scenario: mock sequence (tool_call → final text), assert `tool_calls` logged in AgentResponse
- [x] Fallback scenario: anthropic (no key) fails, ollama mock serves — asserts content from fallback
- [x] Multi-turn scenario: `LLM_HISTORY_TURNS=2`, capturing mock asserts prior turns appear in request body

---

## v0.3.0 — Ecosystem integration

**Scope**: refarm-stack compatibility, distro enablement, multi-agent.

### refarm-stack (agents-lab)
- [ ] `refarm-stack` package in `aretw0/agents-lab` uses farmhand as engine
- [ ] Porting pi-stack behaviors to Refarm CRDT primitives with minimal friction
- [ ] Validate that distros (`.dev`, `.me`, `.social`) can compose farmhand without core changes

### Multi-agent (swarm)
- [ ] Multiple farmhand instances in the same tractor process
- [ ] Cross-agent coordination via CRDT (read peer's `AgentResponse` nodes)
- [ ] `LLM_AGENT_ID` for namespacing nodes per agent instance

### Zig Pi-Nano host
- [ ] Minimal Zig host that loads `farmhand.wasm` — no Rust runtime
- [ ] Targets RPi Zero / microcontrollers
- [ ] WIT subset: `tractor-bridge` (store/query), `agent-fs` — no `agent-shell`

---

## Tooling notes

### mdt (documentation sync)
[mdt](https://github.com/ifiokjr/mdt) — template-based markdown sync with `mdt check` for CI.

- [x] `.templates/template.t.md` — `env_vars` block is the canonical source for the LLM_* table
- [x] `mdt.toml` scaffolded in `packages/pi-agent/`
- [x] `README.md` wired with `<!-- {=env_vars} -->` markers
- [x] `mdt check` added to CI — `.github/workflows/validate-mdt.yml`, cached `mdt_cli`, scheduled weekly
- [ ] Expand to monorepo root when a second consumer of `env_vars` exists (e.g. `.refarm/config.json` docs)

### Diagram library
Keep architecture diagrams in sync with implementation. When significant structural changes
land (e.g., farmhand rename, streaming), update relevant diagrams before closing the milestone.
