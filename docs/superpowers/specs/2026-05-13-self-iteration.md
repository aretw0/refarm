# Refarm Self-Iteration Spec

> **What problem are we solving?** Refarm should be able to modify its own
> codebase: add features, fix bugs, run tests, commit — through the same
> interface a user would use today. This is not a future capability; the stack
> is already assembled. This spec maps where we are, where the gaps are, and
> what to do in order.

---

## What self-iteration actually means

A user types `refarm chat "add a healthcheck endpoint to the HTTP sidecar"`.
Pi-agent (running as a WASM plugin inside farmhand) calls `agent-fs.read` to
explore relevant files, calls `agent-fs.edit` to apply changes, calls
`agent-shell.spawn` to run `pnpm typecheck && pnpm test`, reads the output,
iterates if tests fail, then commits. The user sees streaming output throughout.

Refarm iterating on itself is exactly this — with the working directory set to
`/workspaces/refarm` and the LLM reasoning about refarm's own structure.

No new primitives are required for self-iteration. The question is: does the
existing stack work reliably, and what tuning does it need?

---

## Current stack (already assembled)

```
refarm chat (apps/refarm/src/commands/chat.ts)
  └─ submits Effort { tasks: [{ pluginId: "@refarm/pi-agent", fn: "respond" }] }
       └─ POST http://127.0.0.1:42001/efforts  →  farmhand HTTP sidecar
            └─ FileTransportAdapter: writes task to ~/.refarm/tasks/<id>.json
                 └─ farmhand task executor: calls tractor.plugins.load("@refarm/pi-agent").respond(payload)
                      └─ pi-agent WASM (packages/pi-agent) executing inside wasmtime
                           ├─ LLM call (MODEL_PROVIDER env — Anthropic/OpenAI/Groq/...)
                           ├─ agent-fs.read/write/edit  → TractorNativeBindings (host/agent_tools_bridge.rs)
                           ├─ agent-shell.spawn         → TractorNativeBindings (host/agent_tools_bridge.rs)
                           └─ structured-io             → TractorNativeBindings
                 └─ StreamChunk nodes → FileStreamTransport → ~/.refarm/streams/<effortId>.ndjson
refarm chat follows SSE/file stream, renders output to terminal
```

Key files:
- `apps/refarm/src/commands/chat.ts` — CLI REPL, effort builder, stream follower
- `apps/farmhand/src/transports/http.ts` — HTTP sidecar, effort ingestion
- `packages/tractor/src/host/agent_tools_bridge/core.rs` — agent-fs/agent-shell host impl
- `packages/pi-agent/src/lib.rs` — the agent itself (LLM routing, ReAct loop, tool dispatch)
- `packages/pi-agent/wit/` — WIT world: exports `integration#respond`, imports `agent-fs`, `agent-shell`
- `scripts/pi-agent-install.mjs` — copies compiled WASM → `~/.refarm/plugins/@refarm/pi-agent/`

---

## What pi-agent does today

Pi-agent (`packages/pi-agent`) is a Rust/WASM component that:

- Routes LLM calls across providers via env vars (`MODEL_PROVIDER`, `*_API_KEY`)
- Runs a tool-use loop up to `MODEL_TOOL_CALL_MAX_ITER` iterations (default 5)
- Calls agent-fs (read/write/edit files) and agent-shell (spawn subprocesses)
- Streams partial responses when `MODEL_STREAM_RESPONSES=1`
- Maintains conversational history up to `MODEL_HISTORY_TURNS` turns (default 0 — disabled)
- Respects a spend budget cap per provider (`MODEL_BUDGET_<PROVIDER>_USD`)
- Applies a fallback provider on error (`MODEL_FALLBACK_PROVIDER`)

The `respond(payload)` export takes a JSON-encoded payload and returns a
JSON-encoded `AgentResponse`. The payload carries the user's prompt, system
prompt, and session context assembled by the chat CLI.

---

## True gaps (what's actually missing)

### Gap 1 — Installation is a manual step (highest impact) — ADDRESSED

Farmhand now auto-installs pi-agent on boot via `bundleInstallPlugin`, reading
the WASM from the co-located npm package (`@refarm.dev/pi-agent` dist/jco/).
A version file (`.version`) prevents unnecessary reinstalls. The `scripts/pi-agent-install.mjs`
script remains for backward compatibility but is no longer the primary path.

To manually trigger install: `refarm agent install`
To check for updates: `refarm agent update`

This is resolved — a fresh devcontainer or CI runner works without manual steps.

### Gap 2 — History turns disabled by default — OPERATOR PROFILE AVAILABLE

`MODEL_HISTORY_TURNS` defaults to 0. Self-iteration requires the agent to
remember context across turns (what it just edited, what tests said). Without
history, every `refarm chat` message starts fresh — the agent cannot reason
about its own prior actions.

**Path forward**: Apply the explicit coding profile when self-iteration is
desired:

```bash
refarm config profile coding --local --json
refarm runtime ensure --wait --next-command
```

This writes `MODEL_HISTORY_TURNS=20` to the selected `.refarm/config.json`.
The chat CLI already carries session IDs; pi-agent reads history from the CRDT
if turns > 0.

### Gap 3 — Tool loop depth capped at 5 — OPERATOR PROFILE AVAILABLE

`MODEL_TOOL_CALL_MAX_ITER=5` limits the ReAct loop. A coding task often needs:
read → understand → edit → run tests → read failure → edit again → run again.
That's 6–10 tool calls minimum for a non-trivial change.

**Path forward**: The coding profile writes `MODEL_TOOL_CALL_MAX_ITER=20`.
Future work can still add a per-run `refarm chat --depth <n>` override, but
the durable repo-local path now exists through `refarm config profile coding`.

### Gap 4 — Streaming not enabled by default — OPERATOR PROFILE AVAILABLE

`MODEL_STREAM_RESPONSES` is opt-in. Without it, the user sees nothing until the
task completes. For multi-minute coding tasks this is a bad experience.

**Path forward**: The coding profile writes `MODEL_STREAM_RESPONSES=1`.
This keeps streaming opt-in while making the recommended self-iteration setup
one deterministic command.

### Gap 5 — No preflight check for farmhand availability

`refarm chat` fails with a fetch error if farmhand is not running. The error
message is opaque. ADR-065 (farmhand auto-start) covers this, but until it
ships, users must manually start farmhand before `refarm chat`.

**Path forward**: ADR-065 implementation (detect not running, offer Y/n, spawn
detached). See `docs/superpowers/specs/` for the pending ADR-065 spec.

### Gap 6 — Verification contract in system prompt — ADDRESSED

Pi-agent can run tests via agent-shell, but it doesn't know to run them. The
system prompt and/or task prompt must instruct it to verify before committing.

`buildSystemPrompt` in `@refarm.dev/context-provider-v1` now includes a
conditional coding workflow instruction: when the user asks for code edits, the
agent should inspect the workspace, keep changes focused, verify before
reporting completion, and prefer deterministic Refarm handoffs such as
`refarm package-manager --json` and
`refarm agent finish --fix --run --json`. The prompt avoids hardcoding a
specific JavaScript package manager; package-manager selection remains delegated
to Refarm's resolver.

---

## Architecture decision: why pi-agent, not a TypeScript agent?

Why run the agent in WASM rather than as a plain TypeScript service?

1. **Policy enforcement**: `agent-shell` caps subprocess timeout at 30s and enforces
   non-empty argv. This boundary is enforced at the WASM host level regardless
   of what the agent code tries to do. A TypeScript agent could accidentally
   bypass this.

2. **Portability**: The same pi-agent.wasm runs on any host that provides the
   WIT interfaces. Future farmhand targets (RPi, embedded, browser OPFS) don't
   require rewriting the agent.

3. **Extensibility boundary**: The WIT `integration#respond` export is the stable
   API. Farmhand doesn't need to know anything about LLM routing, tool loops, or
   provider selection — those are the guest's problem. A TypeScript agent would
   couple these concerns.

4. **Scarecrow alignment**: Steps 3+4 of the Barn evolution add observation hooks
   and policy plugins. These apply uniformly to any WASM plugin, including
   pi-agent, without changes to the agent itself.

The trade-off: WASM requires a compile step and is harder to iterate on quickly.
The install script bridges this — a hot-reload path (`POST /plugins/reload`) is
already implemented for rapid iteration once the binary exists.

---

## Sequencing

**Phase 1 — Make it work (today)**

1. Farmhand auto-installs pi-agent on boot (no manual step needed)
2. Apply the repo-local coding profile:
   ```
   refarm config profile coding --local --json
   refarm runtime ensure --wait --next-command
   ```
3. Start farmhand, run `refarm chat "describe the farmhand HTTP sidecar"`
4. Verify streaming output and tool calls appear

**Phase 2 — Make it reliable**

- Add preflight check in `refarm chat`: detect missing `@refarm/pi-agent` plugin
  and fail fast with instructions (e.g., "Run: `refarm agent install`")
- ADR-065: farmhand auto-start so `refarm chat` works without a separate daemon
- Monitor bundled install logs to ensure pi-agent consistently installs on farmhand boot

**Phase 3 — Make it self-aware (coding system prompt) — started**

- `context-provider-v1` injects a coding workflow instruction into the shared
  system prompt used by `refarm ask` and `refarm chat`.
- `refarm agent finish --profile package --workspace <dir>` adds package-level
  validation by discovering existing `type-check`, `lint`, and `build` scripts
  through Refarm's package-manager resolver instead of hardcoding pnpm/npm/yarn.
- `refarm agent finish --profile affected` turns Git status into package-level
  validation automatically, preserving the quick finish gate and appending
  scripts for changed workspaces.
- `GitStatusContextProvider` now emits an `affected_workspaces` context block
  with workspace-relative package candidates and matching package validation
  commands. This lets pi-agent choose the package finish profile from context
  instead of guessing from raw `git status` output.
- Remaining work: make the instruction richer when the workspace exposes
  project-specific policies, for example AGENTS.md, Scarecrow policies, or
  package-level policy metadata.

**Phase 4 — Scarecrow boundary (Barn Steps 3+4)**

- Add WIT observation hooks so farmhand can audit every agent-fs write and
  agent-shell spawn during self-iteration
- Policy plugin enforces: no writes outside `/workspaces/refarm`, no arbitrary
  network calls, commit messages must follow the project convention
- This is the safety layer for unattended self-iteration

---

## Related specs and ADRs

- `docs/superpowers/specs/2026-05-13-barn-scarecrow-evolution.md` — cache and policy architecture
- `docs/superpowers/specs/2026-05-01-pi-agent-effort-bridge-design.md` — effort bridge
- `specs/features/pi-agent-effort-bridge.md` — feature spec
- `specs/ADRs/ADR-050-zig-wasm-agent-tool-host.md` — tool host strategy
- `specs/ADRs/ADR-017-microkernel-boundary.md` — guest/host boundary

---

## Open questions

1. **Context window pressure**: Multi-file code edits can overflow pi-agent's
   context. Should the context provider compress/summarize before sending?
   The `SESSION_DIGEST` provider is a start; compaction thresholds from
   agents-lab's `context-watchdog` (50%/68%/72%) are worth evaluating — but
   only after we understand why those specific thresholds were chosen there.

2. **agent-shell working directory**: Does `agent-shell.spawn` respect the effort's
   working directory, or does it always use farmhand's CWD? If the latter, relative
   paths in `pnpm test --filter` commands may not work as expected.

3. **Commit identity**: When pi-agent commits, git needs a user name and email.
   Does the farmhand environment have `GIT_AUTHOR_*` set, or does it inherit from
   `~/.gitconfig`? An unattended agent should commit as `refarm-bot` or similar.
