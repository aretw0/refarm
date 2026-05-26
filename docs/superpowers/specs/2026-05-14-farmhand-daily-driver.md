# Farmhand Daily Driver Spec

> **What problem are we solving?** `refarm` should be the only command a user
> needs — the same role `claude` plays for Claude Code. The original gaps were
> transparent runtime startup, REPL polish, and in-flow credential/configuration.
> Several of those are now implemented; this spec tracks what remains for the
> daily-driver milestone.

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
- **Runtime lifecycle** — `refarm`, `refarm chat`, and `refarm ask` use the
  shared session-launch readiness path and can ensure the selected runtime when
  policy allows it
- **Stream following** — NDJSON polling from `~/.refarm/streams/<effortId>.ndjson`
  with timeout handling
- **Plugin hot-reload** — `/reload [id...]` hits `POST /plugins/reload` in the
  HTTP sidecar, no daemon restart needed
- **Context providers** — CWD, git status, date, session digest are automatically
  injected into each effort payload
- **`refarm doctor`** — deterministic health audit (filesystem, builds, alignment)
- **Coding profile** — `refarm config profile coding --local --json` writes
  repo-local runtime tuning for history, tool-loop depth, and streaming
- **`checkSessionReadiness()`** — probes farmhand, detects provider config; the
  readiness plumbing already exists in `session-launch.ts`
- **Readline history** — prompts persist in `~/.refarm/chat-history`
- **In-REPL model/credential controls** — `/login`, `/model`, `/reload`, `/new`,
  and `/session` are available in the REPL

### What's missing (the gaps)

---

## Gap 1 — Transparent runtime auto-start — ADDRESSED

**Status**: Implemented through the runtime lifecycle abstraction.

When `refarm`, `refarm chat`, or `refarm ask` needs a runtime and the sidecar is
not ready, the shared launch flow can prompt and run:

```
refarm
✗  Refarm runtime is not running.

   Start it now? (Y/n) _
   → Starting TypeScript Farmhand... ✓ Ready (1.2s)

refarm ▸ _
```

The implementation now resolves `tractor.engine`, prefers the Rust tractor when
available, falls back to TypeScript Farmhand when appropriate, and prints
deterministic recovery commands such as `refarm runtime ensure --wait --next-command`.

---

## Gap 2 — Crash resilience after auto-start (ADR-065 Phase 3) — ADDRESSED

If the selected runtime crashes after the REPL is already open, effort
submission now detects connection-level sidecar failures, runs the same runtime
auto-start policy used at session launch, and retries the same effort once after
recovery. The session ID and readline history remain intact because the REPL was
already paused for the active turn.

Non-connection submission errors, such as runtime HTTP failures, are not treated
as restart signals; they still surface as normal task/runtime errors.

---

## Gap 3 — In-REPL credential/model configuration — PARTIALLY ADDRESSED

The REPL now has `/login` and `/model` controls, so common credential and model
route changes no longer require leaving the session.

Current commands:

| Command | Effect |
|---|---|
| `/login` | Pause readline → run credential collection flow → resume |
| `/model current` | Inspect active model routing |
| `/model providers` | Inspect provider defaults and credential env vars |
| `/model <provider/model>` | Switch the default route |
| `/provider <provider/model>` | Alias for switching the default route |
| `/model worker <provider/model>` | Switch the worker route |
| `/model monitor <provider/model>` | Switch the monitor route |
| `/model fallback <provider/model>` | Set fallback route |
| `/model base-url <url>` | Set self-hosted/OpenAI-compatible endpoint |

Alias decision: `/sow` is supported as an alias for `/login`, and `/provider`
is supported as an alias for `/model`. The stable vocabulary remains `/login`
and `/model`; the aliases exist for operator muscle memory.

---

## Gap 4 — Readline history — ADDRESSED

`refarm chat` loads and saves prompt history in `~/.refarm/chat-history`, skips
slash commands, deduplicates repeated prompts, and caps history length.

---

## Gap 5 — Spinner UX for long-running tasks — ADDRESSED

The `spinnerMessage` hook exists in `ChatDeps` and farmhand sends stream chunks.
`chat.ts` clears the spinner line with `\r\x1b[2K` before writing the first
stream chunk, and the behavior is covered by a deterministic TTY test.

Non-TTY output remains quiet, so scripted/headless flows do not receive spinner
frames.

---

## Gap 6 — `pi-agent` preflight check — ADDRESSED

`refarm ask` checks runtime plugin state and can install/reload pi-agent with
machine-readable recovery commands. `refarm chat` now performs the same preflight
before entering the REPL: if pi-agent is installed but not loaded, it attempts a
reload; if it remains unavailable, the REPL does not start and the user gets
deterministic install/reload/runtime recovery commands.

---

## Sequencing

**Today (unblock daily use):**
1. Validate first-run devcontainer path end-to-end after a clean rebuild

**Next sprint:**
3. TUI-backed config surface for no-argument `refarm config`
4. Package-level validation profiles for coding-agent verification — started via
   `refarm agent finish --profile package --workspace <dir>`

**After daily-driver milestone:**
5. TUI mode — `refarm` bare launches a full-screen TUI (already partially
   implemented in `tui.ts` and `tui-actions.ts`, gated behind `--launch` flag)

---

## Definition of done

A developer can:
1. Start a fresh devcontainer (or fresh machine with refarm cloned and built)
2. Type `refarm` and get a working REPL within 3s — farmhand auto-started if needed, pi-agent auto-installed on farmhand boot
3. Ask a multi-step coding question, see streaming output with tool calls
4. Type ↑ to recall previous prompts
5. Type `/reload` to hot-reload a plugin they just changed
6. Close and reopen — session ID and readline history are preserved

---

## Related

- `specs/ADRs/ADR-065-farmhand-transparent-lifecycle.md` — accepted decision
- `specs/features/tui-daily-driver.md` — feature spec for chat REPL
- `docs/superpowers/specs/2026-05-13-self-iteration.md` — pi-agent install dependency
- `apps/refarm/src/commands/session-launch.ts` — readiness check and LaunchDeps
- `apps/refarm/src/commands/chat.ts` — REPL main loop
