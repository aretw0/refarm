# Manual test plan — the parts that genuinely need a human (or a real agent run)

Everything with a testable seam is unit-tested (see the note per item). This doc is ONLY for what a
headless suite cannot assert: real-TTY visual behavior, a real keyboard, an OS signal, or a live agent
run. Each item: what to run, what to verify, and the automated test that already covers the LOGIC (so the
manual pass is only the signal a machine can't see).

> Convention: `<cli>` = the example's CLI (`dgk`, or a white-labeled `DGK_COMMAND`). Build first:
> `pnpm --filter <example> build`. Run in a REAL terminal (a pipe/CI has no TTY → the faces fall back to
> one-shot, so these must be done by a person).

## 1. Interactive dashboard `-i` (real TTY)

```bash
<cli> dashboard -i
```
- **Verify:** arrow keys move focus between cards (the focused card is highlighted); `tab` cycles; the
  grid feels spatial (←/→ within a row, ↑/↓ across rows). `Esc` exits and the screen is restored (your
  prompt returns clean, no leftover alt-screen).
- **Enter on a no-arg verb:** dispatches immediately; its envelope prints on the normal screen.
- **Enter on an args verb** (e.g. a search/verb with a required arg): an inline FORM opens — type into a
  text field, `space` toggles a `[x]` boolean, `←/→` cycle an enum, `Tab` moves between fields, `Enter`
  submits (blocked until required fields are filled), `Esc` cancels. On submit the verb dispatches with
  the collected argv.
- _Logic already unit-tested:_ focus nav (`tui-focus.test`), the loop (`tui-interactive.test`), the form
  incl. boolean/enum (`tui-form.test`), the arg→argv dispatch wiring (`host.test`). The manual pass is the
  real keyboard + the highlight + the screen restore.

## 2. `status-panel` severity colours (real TTY)

```bash
<cli> status-panel
```
- **Verify:** each stat-card's label is coloured by severity — red for error/critical, yellow for
  warn, green for ok/verified/ready — and the "Next:" footer lists the recommended commands.
- **Interactive (`status-panel -i`, real TTY):** arrow keys navigate the "Next:" commands (the focused one
  is highlighted); `Enter` picks it and the chosen command prints on the normal screen (`▶ <command>`);
  `Esc` exits with none selected. A pipe/CI (no TTY) falls back to the one-shot render.
- _Logic already unit-tested:_ the panel layout + severity→colorizer map, the focus highlighting, and the
  interactive navigation/select loop (`runInteractiveStatusPanel`) — all in `tui-status.test`. The manual
  pass is the real keyboard + the colours + the screen restore.

## 3. Dashboard / table colours + wrapping (real TTY)

```bash
<cli> dashboard            # bordered card grid, coloured (heading/name/summary)
```
- **Verify:** the cards are bordered boxes, coloured, and the grid WRAPS responsively when you resize
  the terminal narrower/wider. A wide-glyph label (emoji/CJK) stays aligned (no column drift).
- _Logic already unit-tested:_ layout + wrapping (`tui-layout.test`), border + ANSI-safe render
  (`tui-render.test`), wcwidth measure + grapheme truncation (`tui-layout`/`tui-render` tests). The
  manual pass is the actual colour + the eyeball on alignment.

## 4. `runLiveTerminal` — Ctrl-C (SIGINT) restores the screen

`runLiveTerminal` installs a SIGINT handler that leaves the alt-screen + shows the cursor before exiting —
this is the one path a unit test can't drive (a real signal that ends the process).
- **Verify (once a live consumer exists, e.g. item 5):** while a live view is running, press `Ctrl-C`.
  Your terminal must return clean — cursor visible, no alt-screen residue, prompt normal.
- _Logic already unit-tested:_ the alt-screen enter/paint/restore framing (`tui-live.test` drives
  `runLiveTerminal` with an injected write). Only the SIGINT branch is manual.

## 5. `agent-watch` — live agent event table (real TTY)

**Built.** T1's `agent-watch` (`examples/devbench-t1/src/agent-watch.ts`, bin
`pnpm --filter devbench-t1 agent-watch`) reads the agent's `agent:*` event file
(`{refarmDir}/scarecrow-audit.ndjson`, `refarmDir = DGK_REFARM_DIR ?? ".dgk"`) and REPLAYS it as a LIVE,
growing table via `runLiveTerminal` + `renderTable` — "watch the machine work".
Two modes, both behind testable seams:
- **REPLAY** (default): `pnpm --filter devbench-t1 agent-watch` — render what's already recorded.
- **FOLLOW** (`--follow`): tail the file live — re-read the growing event file each poll and paint each
  newly-appended `agent:*` line as it arrives (poll-based `pollingSnapshotSource`, so no fs.watch needed).

**Both pipelines are unit-tested** (`agent-watch.test.ts` + `tui-live.test.ts`): `agentEventRows`
(event→row), `watchAgentEvents({events, output})` (replay), and `followAgentEvents({snapshot, wait, done,
output})` — the growing table AND the live tail are asserted frame-by-frame headless (the `output` seam;
the tail drives a growing in-memory snapshot + an instant `wait`, and one case reads a REAL ndjson file to
prove the fs path + the `agent:*` filter). The generic tail primitive `pollingSnapshotSource` is tested in
the engine. No human is needed for any rendering/tailing LOGIC.
- **Manual pass (real TTY + a live run only):** in one terminal run an agent (`<t1-cli> agent-telemetry
  --mock` writes `agent:*` events); in another run `pnpm --filter devbench-t1 agent-watch --follow
  DGK_REFARM_DIR=<that run's dir>` — rows must appear live as the run progresses, and `Ctrl-C` must restore
  the screen (item 4). This is the only part a headless suite can't drive (a real second process + a real
  signal).

## 6. `agent-activity` — the WEB twin of agent-watch (live SSE table in a browser)

The same "watch the machine work" face, projected to the DOM: `mountLiveEventTable`
(`@refarm.dev/capability-homestead-surface`) grows an HTML table one row per `agent:*` event — the browser
twin of the TUI live view. T1's `mountAgentActivity`/`replayAgentActivity`/`followAgentActivity`
(`examples/devbench-t1/src/web/agent-activity.ts`) wire it to the agent's events.
- **Logic unit-tested in jsdom** (`live-events.test.ts` + `agent-activity.test.ts`): the empty→grow table,
  the `maxRows` rolling window, and the `arrayEventSource` replay to completion are all asserted headless
  with a scripted/array source — no real `EventSource`. The row mapping (`agentActivityRow`) too.
- **The SSE server tail is now WIRED + tested:** `dgk serve` auto-mounts `GET /agent/events`, which streams
  the `agent:*` events as Server-Sent Events (`createAgentEventStreamHandler` → the generic
  `createEventStreamHandler` mounted via serveCapabilities' `routeHandlers` hook). The streaming (frames,
  unsubscribe-on-disconnect) is unit-tested (`event-stream.test`), the poll (new-events-since-seen) is
  unit-tested (`agent-event-stream.test`), and an integration test stands up a REAL server and proves the
  SSE stream survives the request timeout (`mount.test`). serveCapabilities' request timeout no longer
  destroys a streaming (headers-sent) response.
- **Manual pass (a real browser + a live run only):** `dgk serve`, then open a page that calls
  `followAgentActivity(container, "http://localhost:4323/agent/events")` and run an agent — rows must appear
  live in the browser as the run progresses. Only the browser page + the real run stay manual — the twin of
  item 5's two-terminal check. `replayAgentActivity(container, events)` needs no server (offline demo).

---

> The rule (see the memory `feedback-testabilidade-primeiro-seams-ou-plano`): inject the seam and test it;
> only what truly needs a person or a real signal lands here — with the exact steps to verify it.
