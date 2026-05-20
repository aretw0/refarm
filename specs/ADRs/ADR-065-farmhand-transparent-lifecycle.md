# ADR-065: Farmhand Transparent Lifecycle & Single Entry Point

**Status**: Accepted  
**Date**: 2026-05-12  
**Deciders**: Arthur Silva  
**Related**: ADR-060 (Tractor HTTP Sidecar Protocol), DEC-036, specs/features/tui-daily-driver.md

---

## Context

`refarm` is positioned as the single entry point for the user — the same role `claude` plays for Claude Code. The current flow requires the user to manually run `npm run farmhand:daemon` before `refarm` works, which breaks the "one command" promise.

Additionally, credential flows (`refarm sow`) and configuration live outside the REPL. Pi's `/login` shows the right pattern: the running session surfaces provider auth flows inline without leaving the tool.

**The tension:**  
Farmhand is a daemon — it needs to run persistently to serve the REPL. But the user shouldn't need to know or care about that.

---

## Decision

**We will make farmhand transparent and `refarm` the single operational entry point.**

### 1. Auto-start farmhand on first use

When `refarm` detects farmhand is not running and the provider is configured:

```
refarm
✗  Farmhand is not running.

   Start it now? (Y/n) _
   → Starting farmhand...  ✓ Ready (1.2s)

refarm ▸ _
```

- **Confirm before starting** — respect that the user may not want a background process spawned silently.
- **Respect explicit operator policy** — `.refarm/config.json` may set
  `autostart` to `always`, `ask`, or `never`; `REFARM_FARMHAND_AUTOSTART`
  may override it for scripts, tests, CI, and headless usage.
- **Detached spawn** — farmhand runs independently of the refarm CLI process.
- **Poll until ready** — probe `GET /efforts/summary` every 300ms, max 10s, with elapsed time shown.
- **Fallback on timeout** — if farmhand doesn't start in time, print manual instructions and exit.

### 2. In-REPL configuration commands

REPL commands for flows that currently require leaving the session:

| Command | Effect |
|---|---|
| `/sow` | Pause readline → run credential collection flow → resume session |
| `/keys` | Pause readline → run model key setup → resume session |
| `/provider` | Switch active model provider without restarting |

Implementation contract: the REPL `close()` readline → run interactive flow → `reopen readline` → print prompt. The session ID is preserved throughout.

### 3. Progressive consolidation

Refarm does not need to absorb everything at once. The direction is:

- `refarm` (bare) → REPL, auto-starting farmhand if needed ✅ (this ADR)
- In-REPL `/sow`, `/keys` → configuration without leaving ← next
- `refarm doctor` → surface all health/token checks inline ← after
- Farmhand stop/restart → managed from within refarm (`/restart`, or automatic on crash) ← later

---

## Alternatives Considered

### Option A: Always auto-start, no confirmation
Cleaner UX but surprises users who didn't expect a background process.  
**Rejected**: confirmation is cheap, trust is not.

### Option B: Keep manual daemon step, document it better
Lower implementation cost.  
**Rejected**: breaks the single-entry-point promise. Users comparing to `claude` will find this jarring.

### Option C: Embed farmhand in the refarm process (no separate daemon)
Simpler for the user, no daemon management.  
**Rejected**: DEC-036 already decided against this — multiple consumers (TUI, WEB, scripts) need to share the same farmhand instance.

---

## Consequences

**Positive:**
- `refarm` becomes truly the only command a user needs to remember
- First-time experience matches Claude Code / Pi — one command, everything else follows
- `/sow` in REPL removes the "exit and reconfigure" friction

**Negative:**
- Auto-start adds spawn complexity and a polling loop to the launch path
- readline pause/resume for in-REPL flows needs careful handling to avoid state corruption

**Risks:**
- Farmhand crash after auto-start: REPL should detect lost connection and offer restart. Mitigation: `probeFarmhand()` on each effort submission; reconnect/restart prompt on failure.
- Port conflict: farmhand-start.sh already handles this with a clear error message.

---

## Implementation

**Phase 1 — Auto-start (current):**
- `session-launch.ts`: `autoStartFarmhand()` — confirm → spawn → poll
- `LaunchDeps` interface for testability (same pattern as `ChatDeps`)
- Inject repo root via `fileURLToPath(import.meta.url)` (same pattern as `keys.ts`)
- `readAutostartMode()` reads `REFARM_FARMHAND_AUTOSTART` first, then
  `.refarm/config.json`, then defaults to `ask`

**Phase 2 — In-REPL configuration:**
- `chat-repl.ts`: add `/sow`, `/keys` to `ChatCommand` discriminated union
- `chat.ts`: pause readline, run flow, resume — `rl.pause()` / `rl.resume()`
- `sow.ts` and `keys.ts` must be callable as functions (not just CLI actions)

**Phase 3 — Crash resilience:**
- Probe farmhand on each effort submission
- On connection refused: offer `/restart` or auto-restart

---

## References

- ADR-060: Tractor HTTP Sidecar Protocol
- DEC-036: refarm chat as HTTP sidecar client
- specs/features/tui-daily-driver.md
- Pi agent `/login` pattern (reference implementation)
