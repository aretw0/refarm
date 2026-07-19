# TUI Interactivity — Plan (Task 4 of the layout engine, its own slice)

> **Status: EXECUTED (2026-07-19).** Built as three TDD slices in `packages/surface-terminal` (+ the
> `dashboard -i` wiring in `@refarm.dev/capabilities-v1`): a thin own loop over our Yoga tree (React-free),
> with an injectable input seam. The layout engine's positioned boxes supplied the focus/hit-test data, so
> this added only input + focus + redraw. The runway (below) was the plan; it's now landed.

## Why it is separate (and was right to defer)

The landed `dashboard` is a ONE-SHOT render: `surfaceModelToLayout → computeTuiLayout → renderTuiLayout`
→ print. Making it **navigable** (arrow between cards, Enter runs the verb) needs three things the layout
engine deliberately does NOT do:

1. **Input** — raw-mode key events (arrows, Enter, Esc, Tab), injectable for tests, cleaned up on exit.
2. **Focus model** — which node is focused, focus order, and hit-testing — *over the positioned tree we
   already produce*.
3. **Redraw loop** — re-render on state change, alt-screen enter/leave, cursor hide/show, no flicker.

These are orthogonal to flex math. The interactive loop that exists today (the readline `tui` menu) is a
different, simpler shape; upgrading it to a laid-out, focusable grid is a real subsystem.

## What we already have (the preparation done)

- `computeTuiLayout` returns **PositionedNode** with absolute `x/y/w/h` per box — this IS the hit-test
  and focus-order data. A focus model is a traversal over it, not new geometry.
- `renderTuiLayout` gives the frame to repaint each tick; focus is a style overlay (e.g. a focused card
  rendered with an inverted/highlighted colorizer).
- `defaultDashboardColors` shows the colorizer seam a focus highlight plugs into.

So Task 4 starts with the "space" half solved; it adds only the "input/focus/redraw" half.

## The decision to make first: adopt vs. build

| Option | What it is | Fit |
| --- | --- | --- |
| **Ink** | React reconciler for the terminal (Yoga under the hood — same engine we adopted) | Powerful, but pulls React + a reconciler; our faces are NOT React (vanilla DOM / string renderers). Heavy coupling. |
| **Thin own loop** | raw-mode input seam + focus model over our PositionedNode + a redraw over `renderTuiLayout` | Reuses what we built (Yoga already ours); no React; matches the repo's dependency-light terminal style (readline, not a framework). Authorship cost is the focus/redraw loop — bounded. |
| **blessed / neo-blessed** | Older full TUI widget lib | Unmaintained-ish, its own layout (conflicts with our Yoga engine). LEARN-FROM only. |

**Leaning: thin own loop** — we already own the hard generic math (Yoga); interactivity over our own
positioned tree keeps the stack coherent and React-free. LEARN-FROM Textual/ratatui for the focus/redraw
*patterns* (focus order, dirty-region redraw), don't adopt their runtime. Confirm at Task-4 kickoff.

## Slices (when we act)

### Slice 1 — Input seam + focus model (TDD) — ✅ DONE
- [x] `tui-input.ts`: the `Key` + `TerminalInput` seam + `scriptedInput` (a headless, deterministic key
  source) so a loop is testable with no TTY — mirrors how `TuiIo` injects lines.
- [x] `tui-focus.ts`: `focusOrder(positioned)` collects focusable boxes in reading order; `moveFocus(order,
  current, key)` — reading-order for left/right/tab (wrapping), geometric nearest for up/down. Pure, tested.
- [x] `LayoutNode`/`PositionedNode` gained optional `id` + `focusable`, carried through `computeTuiLayout`
  — wired NOW because `focusOrder` is their consumer, not speculatively.

### Slice 2 — Redraw loop (TDD) — ✅ DONE
- [x] `runInteractiveLayout({targets, render, input, output, onSelect})`: the PURE core — render, read key,
  move focus (repaint on change), Enter → `onSelect`, Esc/Ctrl-C/exhausted → exit. Input+output injected →
  unit-tested headless. `createStdinInput` (raw-mode keypress, restores on close) + `runInteractiveTerminal`
  (alt-screen + cursor, ALWAYS restores, even on throw) are the node-only wiring the pure core drives.

### Slice 3 — Focusable dashboard (the payoff) — ✅ DONE
- [x] `runInteractiveDashboard(model)`: cards are focusable (id = verb name), a focused card's name
  highlights (`colors.focused` = chalk.inverse), arrows navigate, Enter fires `onSelect(verb)`. The
  `dashboard -i` command dispatches the picked verb (via `dispatchCapability`, the shared outcome contract)
  on a real TTY; a pipe/CI falls back to the one-shot print. Tested headless (navigate + dispatch).

## Risks / open questions
- **Raw mode is node-only + must restore** on every exit path (throw, Ctrl-C, Esc) — the loop owns
  cleanup; leaking raw mode wedges the user's terminal. Keep it browser-safe (lazy, CLI-only path, like
  the `dashboard` command's import).
- **Testing interactivity** — the input seam MUST be injectable (scripted keys) so focus/select are
  asserted headless, no TTY. Same discipline as `TuiIo`.
- **Don't reinvent focus/redraw** — LEARN-FROM Textual/ratatui patterns (focus order, dirty redraw).
- **White-label** — `TerminalInput`/focus primitives stay brand-neutral (no `refarm` names).
- **Scope** — keep it one-shot-superset: the interactive dashboard is an *added* mode; the non-interactive
  print stays (CI/pipes have no TTY).
