# terminal-plugin — Roadmap

**Package**: `@refarm.dev/terminal-plugin`  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Current state**: browser display layer — `OutputApi` (log/clear), passive DOM renderer

---

## Role in the ecosystem

The terminal-plugin is the **display** half of the Refarm command surface.
It lives in the browser (JS/TS, DOM) and never executes OS processes.

The **execution** half lives in `agent-tools.wasm` (Rust/WASM, tractor):
it spawns OS processes via `host-spawn` and exports `agent-shell` to other plugins.

```
Browser (JS world)                    Tractor (Rust/WASM world)
────────────────────────────────────  ──────────────────────────────────────
terminal-plugin.ts                    agent-tools.wasm
  • renders output in DOM               • spawns OS processes
  • sends input via WebSocket           • exports agent-shell WIT to pi-agent
  • subscribes to CRDT ShellOutput      • logs ShellOutput nodes to CRDT
  • target: ["browser"]                 • zero DOM, zero JS
```

These two packages serve the same user surface (a terminal) but must never
collapse into one: a browser plugin should not execute processes; a WASM
component should not touch the DOM.

---

## How the full REPL loop works (target)

```
user types → terminal-plugin → WS → tractor → agent-tools.wasm → OS
stdout ←─────────── ShellOutput CRDT node ←── WS ←── tractor ←───┘
```

The same `agent-tools.wasm` execution path serves:

- **terminal-plugin REPL** — user types, sees output in browser
- **pi-agent bash tool** — agent calls `bash`, output logged to CRDT
- **CLI watch** — `tractor-native watch` reads stdin, same WS protocol

Any agent — browser, edge node, Pi Zero, cloud — uses the same executor.
The terminal-plugin is the human window into that execution.

---

## Current state (v0.1.0-dev)

- [x] `OutputApi` — `log(message, level)` and `clear()`
- [x] DOM renderer — scrolling div with timestamp + level formatting
- [x] Integration hooks — `setup()`, `ingest()`, `teardown()`
- [x] `manifest.json` — `provides: ["ui:terminal"]`, target `["browser"]`
- [x] Design system tokens — `refarm-bg-primary`, `refarm-success`, `refarm-error`

---

## Daily-driver live output track (legacy `v0.2.0` bucket)

**Scope**: Connect the display to the execution engine. The terminal stops being
a passive log and becomes a live view of what tractor is doing.

> Recalibration: this is a daily-driver unlock, not a version bump promise. Prioritize only the pieces that help Refarm replace the current pi terminal/agent workflow; defer polish or ecosystem-facing work until after `v0.1.0` is earned.

### WebSocket subscription

- [ ] On `setup()`, open WebSocket to `ws://localhost:42000` (same as BrowserSyncClient)
- [ ] Receive Loro binary deltas → import into local LoroDoc
- [ ] React to new `ShellOutput` CRDT nodes: append to DOM in arrival order
- [ ] `ShellOutput` node schema (to be defined in tractor):
  ```json
  {
    "@type": "ShellOutput",
    "@id": "urn:tractor:shell-<seq>",
    "agent_id": "terminal | pi-agent | ...",
    "stdout": "...",
    "stderr": "...",
    "exit_code": 0,
    "timestamp_ns": 1234567890
  }
  ```
- [ ] Filter by `agent_id` — show only the current session or all (user toggle)

### Input dispatch

- [ ] Add `<input>` element below the output div
- [ ] On Enter: send `{"type":"user:shell","agent":"terminal","payload":"<cmd>"}` via WS
- [ ] Tractor routes `user:shell` → agent-tools.wasm → OS → ShellOutput CRDT node
- [ ] Clear input on send; focus returns to input after response

### OutputApi extension

- [ ] `subscribe(handler: (node: ShellOutput) => void)` — other plugins can react to output
- [ ] `send(command: string)` — other plugins can dispatch commands programmatically
  - Used by pi-agent UI (future) to show what the agent is running in real time

---

## v0.3.0 — Agent transparency

**Scope**: Show what agents are doing, not just what the user typed.
Inspired by Claude Code's tool call display.

### Agent activity stream

_Current audit_: `src/index.ts` is still a passive DOM log sink and does not yet
consume CRDT nodes directly. A workspace scan currently finds `StreamChunk`,
`StreamSession`, and `AgentResponse` stream consumer code only in
`@refarm.dev/tractor` helpers/tests, not in a production UI subscriber. Keep
`BrowserSyncClient` schema-neutral; stream rendering belongs in the UI consumer
that subscribes to Tractor nodes.

- [ ] Subscribe to `AgentResponse` CRDT nodes alongside `ShellOutput` for the
      compatibility projection, or subscribe to generic `StreamChunk` /
      `StreamSession` nodes when rendering live token/lifecycle state.
- [ ] For streaming views, order by `sequence`, stop on `is_final` or terminal
      session status, and use the `@refarm.dev/tractor` reducers instead of
      concatenating CRDT updates ad hoc.
- [ ] Render generic stream labels from reducer metadata helpers
      (`streamChunkProviderFamily`, `streamChunkModel`,
      `streamSessionDurationNs`) rather than parsing opaque metadata in UI code.
- [ ] When an `AgentResponse` has `tool_calls`, render each call inline:
  ```
  ▶ bash ["grep", "-rn", "fn react", "src/"]
    src/lib.rs:126:fn react(prompt: &str) -> ...
  ▶ edit_file path=src/lib.rs [2 edits]
    ✓ applied
  ```
- [ ] Collapsible sections per tool call — verbose mode toggle
- [ ] `agent_id` badge — distinguish terminal user vs pi-agent vs future agents

### Multi-agent awareness

- [ ] Dropdown to select which agent's stream to display
- [ ] "All agents" view — interleaved by `timestamp_ns`
- [ ] Color-coded by agent identity

---

## v0.4.0 — Sovereign REPL hardening (Gondolin lessons)

**Scope**: Apply the security model from [earendil-works/gondolin](https://github.com/earendil-works/gondolin)
to the browser terminal surface. Gondolin uses host-side credential injection and
network allowlisting in micro-VMs; our equivalent lives at the tractor boundary.

### Command allowlist UI

- [ ] Display current `LLM_SHELL_ALLOWLIST` in terminal header
- [ ] Visual indicator when a command is blocked vs allowed
- [ ] UI to propose adding a command to the allowlist (sends to tractor config)

### Credential transparency

- [ ] Never display raw API keys in terminal output (scrub from ShellOutput nodes)
- [ ] Show `[credential:ANTHROPIC_API_KEY]` placeholder when key would appear in output
- [ ] Audit log section: list what credentials were requested by which agent

### Filesystem scope indicator

- [ ] Show current `LLM_FS_ROOT` in terminal header
- [ ] Highlight file paths in output that are outside the allowed root

---

## Renderers vs protocol

The terminal-plugin is one **renderer** of a shared protocol. Other renderers exist
or will exist — they implement the same contract, not the same code:

| Renderer         | Package                            | Surface             | Status      |
| ---------------- | ---------------------------------- | ------------------- | ----------- |
| Browser terminal | `terminal-plugin` (this)           | DOM / browser       | In progress |
| TUI              | `tractor-native watch` subcommand  | crossterm / ratatui | Planned     |
| CLI one-shot     | `tractor-native prompt` subcommand | stdout              | Planned     |

**Shared protocol** (the actual contract between all renderers and tractor):

- Input: `{"type":"user:shell","agent":"<id>","payload":"<cmd>"}` via WebSocket text frame
- Output: `ShellOutput` CRDT node broadcast as Loro binary delta via WebSocket
- Same node schema, same WebSocket connection, same port (42000)

Adding a new renderer — ncurses, native mobile, voice — requires only implementing
the WebSocket client. The tractor execution engine does not change.

---

## Architecture invariants (never violate)

1. **No process execution in browser** — terminal-plugin never spawns OS processes.
   All execution goes through tractor → agent-tools.wasm → host-spawn.

2. **No credentials in DOM** — API keys, tokens, secrets must never reach the
   browser plugin. Tractor scrubs them from ShellOutput nodes before broadcast.

3. **CRDT as the source of truth** — terminal display is a projection of CRDT state,
   not an independent log. Refreshing the page must restore the full session from CRDT.

4. **Agent-agnostic** — terminal-plugin renders output from any agent (pi-agent,
   future agents, user input). It has no opinion about who generated the output.
