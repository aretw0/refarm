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
- _Logic already unit-tested:_ the panel layout + the severity→colorizer map (`tui-status.test`). The
  manual pass is that the colours actually render.

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

## 5. FEATURE (not yet built) — live agent watch (`<t1-cli> agent-telemetry --watch` or `agent-watch`)

**Spec:** a T1 command that tails the agent's `agent:*` event file (`{refarmDir}/scarecrow-audit.ndjson`)
and renders the events as a LIVE, growing table via `runLiveTerminal` — "watch the machine work". The
live-view engine already exists (`runLiveView` + `runLiveTerminal` + `renderTable`, all tested); this is
the node-only wiring: a `LiveSource` that watches the file (fs.watch or a short poll) and yields each new
`agent:*` line as a row.
- **When built, verify:** in one terminal run an agent (`<t1-cli> agent-telemetry --mock`); in another run
  the watch command — rows appear live as the run progresses; `Ctrl-C` restores the screen (item 4).
- **Testable seam to build it behind:** the `LiveSource` is injectable, so a REPLAY mode (read a recorded
  run's events, replay through `runLiveView`) is unit-testable with a fixture ndjson; only the fs.watch
  tail + the real run stay manual.

---

> The rule (see the memory `feedback-testabilidade-primeiro-seams-ou-plano`): inject the seam and test it;
> only what truly needs a person or a real signal lands here — with the exact steps to verify it.
