# Farmhand Daily Driver Spec

> **What problem are we solving?** `refarm` should be the only command a user
> needs — the same role `claude` plays for Claude Code. Today, three things
> break this promise: farmhand must be started manually before `refarm chat`
> works; the TUI/REPL lacks polish needed for sustained daily use; and there is
> no in-REPL path for credential or configuration flows.

---

## What "daily driver" actually means

A user opens a terminal, types `refarm`, and gets a working REPL within 2
seconds — regardless of whether farmhand was already running. They can ask
questions, submit coding tasks, switch sessions, reload plugins, and configure
credentials without ever leaving the interface. When they come back tomorrow,
their session history is there.

This is not a distant goal. The core stack is already built. The gaps are
specific and small.

---

## Current state

### What works today

- **`refarm chat`** — a persistent readline REPL that submits efforts to
  farmhand and streams responses (apps/refarm/src/commands/chat.ts)
- **Session management** — session IDs persist via session-lock; `/new` resets,
  `/session <prefix>` switches
- **Stream following** — NDJSON polling from `~/.refarm/streams/<effortId>.ndjson`
  with timeout handling
- **Plugin hot-reload** — `/reload [id...]` hits `POST /plugins/reload` in the
  HTTP sidecar, no daemon restart needed
- **Context providers** — CWD, git status, date, session digest are automatically
  injected into each effort payload
- **`refarm doctor`** — deterministic health audit (filesystem, builds, alignment)
- **`checkSessionReadiness()`** — probes farmhand, detects provider config; the
  readiness plumbing already exists in `session-launch.ts`
- **`spawnFarmhand()`** in `LaunchDeps` — interface already defined; the auto-start
  confirmation flow is stubbed for testing

### What's missing (the gaps)

---

## Gap 1 — Farmhand auto-start (ADR-065 Phase 1)

**Status**: ADR accepted, implementation pending.

When `refarm chat` runs and farmhand is not on `:42001`, the user gets a raw
`fetch` connection refused error. The fix is in `session-launch.ts`:

```
refarm
✗  Farmhand is not running.

   Start it now? (Y/n) _
   → Starting farmhand... ✓ Ready (1.2s)

refarm ▸ _
```

**Implementation contract** (from ADR-065):
- Confirm before starting — no silent background processes
- Detached spawn via `spawn('node', [...], { detached: true, stdio: 'ignore' })`
- Poll `GET /efforts/summary` every 300ms, max 10s, show elapsed time
- Fallback on timeout: print manual instructions, exit 1
- `LaunchDeps` interface is already defined in `session-launch.ts` — inject
  real implementations in `chat.ts`, stub them in tests

**Files to touch**: `apps/refarm/src/commands/session-launch.ts` (implement
the stub), `apps/refarm/src/commands/chat.ts` (call `autoStartFarmhand()`
before entering the REPL loop).

---

## Gap 2 — Crash resilience after auto-start (ADR-065 Phase 3)

If farmhand crashes after being auto-started, the next effort submission gets
a connection refused. Today there is no recovery path.

**Target behavior**: on connection refused during an effort submission, pause
the REPL, print `Farmhand stopped responding — restart? (Y/n)`, and restart
if confirmed. The session ID is preserved; no history is lost.

**Files to touch**: `chat.ts` — wrap `deps.submitEffort()` in a try/catch that
detects `ECONNREFUSED`, calls `deps.spawnFarmhand()`, polls until ready, retries.

---

## Gap 3 — In-REPL credential configuration (ADR-065 Phase 2)

Today, configuring a model provider requires exiting `refarm chat`, running
`refarm sow` or `refarm keys`, and restarting. This breaks flow.

**Target REPL commands**:

| Command | Effect |
|---|---|
| `/sow` | Pause readline → run credential collection flow → resume |
| `/keys` | Pause readline → run model key setup → resume |
| `/provider` | Switch active model provider (MODEL_PROVIDER) without restarting |

**Implementation contract**: `rl.pause()` → run interactive flow → `rl.resume()`.
`sow.ts` and `keys.ts` must be callable as functions (not just CLI actions).

**Files to touch**: `apps/refarm/src/commands/chat-repl.ts` (add `/sow`, `/keys`,
`/provider` to `ChatCommand` union), `chat.ts` (handle new commands), `sow.ts`
and `keys.ts` (extract callable function from Commander action).

---

## Gap 4 — Readline history

Today, `refarm chat` does not persist readline history between sessions. The
user cannot press ↑ to recall previous prompts.

**Target behavior**: persist readline history to `~/.refarm/chat-history` (max
500 lines, newest first). On REPL start, load history into `rl.history`.

Node.js `readline.Interface` does not support history persistence natively.
Two options:

- **readline-sync** integration (adds a dependency)
- **Manual** — hook `rl.on('line')`, push to an in-memory array, write to disk
  on exit. Load on startup. ~20 lines of code, no dependency.

The manual approach is sufficient. History file per session-lock or global is a
UX decision — global is more useful for muscle memory.

**Files to touch**: `apps/refarm/src/commands/chat.ts` — add history load/save
around the readline interface.

---

## Gap 5 — Spinner UX for long-running tasks

The `spinnerMessage` hook already exists in `ChatDeps` and farmhand already
sends stream chunks. The gap is the spinner display while waiting for the first
chunk.

`chat.ts` already has a spinner frame logic (`⠸ Thinking…`). The issue is that
the spinner may not clear properly on some terminals when the first chunk arrives,
leaving ghost characters.

This is a polish task, not a structural gap. Verify by running a slow model
response and checking terminal output fidelity.

---

## Gap 6 — `pi-agent` preflight check

If `@refarm/pi-agent` is not installed in farmhand (because `npm run agent:install`
wasn't run), `refarm chat` submits efforts that time out silently. The user has
no indication of what went wrong.

**Target behavior**: on REPL start, `GET /plugins` from the sidecar, verify
`@refarm/pi-agent` is in the loaded plugin list. If not:

```
✗  pi-agent is not installed. Run: npm run agent:install
```

**Files to touch**: `apps/refarm/src/commands/chat.ts` — add plugin preflight
before entering REPL loop. The HTTP sidecar does not currently expose a
`GET /plugins` endpoint; this endpoint needs to be added to `transports/plugins.ts`.

---

## Sequencing

**Today (unblock daily use):**
1. Implement ADR-065 Phase 1 (Gap 1) — auto-start farmhand
2. Add readline history (Gap 4) — 20 lines
3. Add pi-agent preflight check (Gap 6) — requires `GET /plugins` endpoint

**Next sprint:**
4. In-REPL `/sow`, `/keys` (Gap 3)
5. Crash resilience (Gap 2)
6. Spinner cleanup (Gap 5) — polish, verify before claiming done

**After daily-driver milestone:**
7. TUI mode — `refarm` bare launches a full-screen TUI (already partially
   implemented in `tui.ts` and `tui-actions.ts`, gated behind `--launch` flag)

---

## Definition of done

A developer can:
1. Start a fresh devcontainer (or fresh machine with refarm cloned and built)
2. Run `npm run agent:install` once
3. Type `refarm` and get a working REPL within 3s — farmhand auto-started if needed
4. Ask a multi-step coding question, see streaming output with tool calls
5. Type ↑ to recall previous prompts
6. Type `/reload` to hot-reload a plugin they just changed
7. Close and reopen — session ID and readline history are preserved

---

## Related

- `specs/ADRs/ADR-065-farmhand-transparent-lifecycle.md` — accepted decision
- `specs/features/tui-daily-driver.md` — feature spec for chat REPL
- `docs/superpowers/specs/2026-05-13-self-iteration.md` — pi-agent install dependency
- `apps/refarm/src/commands/session-launch.ts` — readiness check and LaunchDeps
- `apps/refarm/src/commands/chat.ts` — REPL main loop
