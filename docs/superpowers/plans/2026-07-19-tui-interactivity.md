# TUI Interactivity — Plan (Task 4 of the layout engine, its own slice)

> **Status: PREPARATION.** Deferred from the layout-engine plan on purpose — interactivity is a distinct
> subsystem (input + focus + redraw), the genuinely-hard "interactive widget" the reinventing-the-wheel
> verdict said to LEARN-FROM Textual/ratatui/Ink. This plan is the runway: what we already have, the
> adopt-vs-build decision, and the slices — so when we act on it we start prepared, not from scratch.

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

### Slice 1 — Input seam + focus model (TDD)
- [ ] `TerminalInput` seam: a `readKey(): Promise<Key>` / event stream over `process.stdin` raw mode,
  INJECTABLE (a scripted key list) so the loop is testable headless — mirror how `TuiIo` injects lines.
- [ ] `focusOrder(positioned, isFocusable)`: extract focusable boxes in a stable order from the
  PositionedNode tree; `moveFocus(order, current, key)` (next/prev/2D by x,y). Pure, unit-tested.
- [ ] Mark focusables: add an optional `focusable`/`id` to `LayoutNode` (cards set it) — wired NOW only
  because this slice is its consumer (no speculative field before its use).

### Slice 2 — Redraw loop (TDD)
- [ ] `runInteractiveLayout(root, {input, render, onSelect})`: alt-screen enter, hide cursor, render,
  read key → move focus → re-render (repaint the focused frame), Enter → `onSelect(focusedId)`, Esc →
  exit + restore (leave alt-screen, show cursor) — cleanup guaranteed even on throw. Test with scripted
  keys asserting the focused id sequence + that a select fires.

### Slice 3 — Focusable dashboard (the payoff)
- [ ] `runCapabilityDashboard(registry)`: the `dashboard` command gains an interactive mode — cards are
  focusable, arrows navigate, Enter dispatches the verb (via `dispatchCapability`, the shared loop).
  A focused card renders with a highlight colorizer. Test: scripted arrows land focus on a known verb,
  Enter dispatches it.

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
