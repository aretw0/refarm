# The TUI subsystem — a laid-out, interactive terminal surface

How the terminal became a first-class surface: a flex **layout engine** + **interactive** primitives that
project the same capability model the web + agent read. The guiding shape is the one the token pipeline
already used (DTCG + Style Dictionary): **adopt the proven generic engine, author only the projection that
is genuinely unserved.** Everything lives in `@refarm.dev/surface-terminal`; the framework
(`@refarm.dev/capabilities-v1`) wires it to commands.

## Division of labour — adopt vs. author

| Concern | Adopted (proven) | Authored (unserved) |
| --- | --- | --- |
| Flex layout math | **Yoga** (`yoga-layout`, the engine Ink uses) | the surface-neutral `LayoutNode` spec + the projection |
| Terminal cell width | **string-width** (ANSI-strip, East-Asian-width, emoji, zero-width) | the measure seam + grapheme-safe truncation |
| Colour | (the DS token pipeline, via `dashboardColorsFromTuiTheme`) | ANSI painting of positioned boxes |
| Interactivity | — (a thin own loop, React-free) | focus model, input seam, redraw loop, input form |

Nothing here re-implements flex, width, or date/JSON — those are crates. What's authored is the
terminal-specific projection: cell metrics, ANSI painting, and the focus/redraw loop.

## The layout engine (the SPACE half; `projectThemeToTui` is the COLOUR half)

```
LayoutNode (surface-neutral spec)
  → computeTuiLayout  (build a Yoga tree, attach a measure fn to text leaves, calculateLayout)
      → PositionedNode (absolute cell x/y/w/h, mirroring the tree)
        → renderTuiLayout (paint each leaf into its box → an ANSI string grid)
```

- **`tui-layout.ts`** — `LayoutNode` (row/column, width/height/flex, padding, gap, align, justify, wrap,
  `border`, `id`/`focusable`, or a `text` leaf) → `computeTuiLayout(root, {width})` → `PositionedNode`.
  Yoga owns the flex math; `defaultMeasureText` (string-width) owns the cell metrics. Async — Yoga's WASM
  initializes once, lazily, and is cached. PURE given the measure fn.
- **`tui-render.ts`** — `renderTuiLayout(positioned)` paints each text leaf into its box (truncate by
  cell width on a GRAPHEME boundary, clip by line count) and draws `border` boxes (┌─┐│└┘). ANSI-aware by
  VISIBLE width: a colored run lands on the column a plain one would, so chalk survives. No cell buffer —
  position-sorted row segments.

## Surfaces on the engine

- **`tui-dashboard.ts`** — `surfaceModelToLayout(model)` maps the SAME `tuiSurfaceModel(registry)` a web
  face reads (sections → items) to a wrapping grid of bordered cards; `renderCapabilityDashboard` runs it
  end to end. `dashboardColorsFromTuiTheme(projectThemeToTui(theme))` sources the palette from DS tokens.
- **`tui-status.ts`** — `renderStatusPanel(model)` maps an operator-status model (BaseSurfaceModel shape,
  as DATA) to severity-coloured stat-cards + a "Next:" footer.
- **`tui-table.ts`** — `renderTable(columns, rows)` lays out a column-aligned table (header + separator +
  rows). Its web twin is `renderTableHtml` in `@refarm.dev/capability-homestead-surface` — the SAME
  `columns` + `rows` render as a terminal table AND a semantic accessible `<table>`. **Convergence is at
  the DATA level**, not a shared layout tree (each surface in its own idiom).

## Interactivity (the input + focus + redraw half)

- **`tui-input.ts`** — the `Key` + `TerminalInput` seam + `scriptedInput` (a headless key source), so
  every loop is unit-testable with no TTY (mirrors how `TuiIo` injects lines).
- **`tui-focus.ts`** — `focusOrder(positioned)` collects focusable boxes from the positioned tree;
  `moveFocus` navigates — arrows are spatial (left/right within a row, up/down to the nearest box), `tab`
  cycles reading-order. The layout engine's boxes ARE the hit-test data.
- **`tui-interactive.ts`** — `runInteractiveLayout` is the PURE loop (render → key → move focus → repaint →
  `onSelect` → exit); `createStdinInput` + `withInteractiveTerminal` are the node-only wiring (raw-mode
  keypress, alt-screen, cursor, always restored).
- **`tui-form.ts`** — `runInteractiveForm` collects typed args, boolean checkboxes (space), and enum
  cycles (arrows); the text-entry widget for interactive dispatch.

## Framework wiring (`@refarm.dev/capabilities-v1` `host.program()`)

Declaring a verb once yields, with zero per-app wiring: a CLI command, a web card/form, an agent tool,
an interactive `tui` menu, and:
- **`dashboard`** — the laid-out card grid. `dashboard -i` (real TTY) navigates + dispatches; a verb with
  args/options is filled through the inline **form** (text/boolean/enum), then dispatched via the shared
  `dispatchCapability` outcome contract.
- **`status-panel`** — the operator status as a laid-out panel (when the host declares `operatorStatus`).

`surface-terminal` is imported LAZILY inside the command actions (it pulls commander/readline/yoga), so
the framework module stays browser-safe.

## Conventions

- **Brand-neutral / white-label.** Every primitive uses neutral names (LayoutNode/PositionedNode/…, no
  `refarm`). Colour is via INJECTED colorizers (default identity → plain, testable in plain text;
  `defaultDashboardColors`/`defaultStatusColors` are the chalk palettes a face opts into).
- **Declare once → project per surface.** The same model/data drives web + TUI + agent; the projection is
  per-surface (CSS flex on the web, Yoga on the terminal, a native `<table>` for tabular data).
- **Testable without a TTY.** Input + output are injected; the pure loops assert focus/select/render
  headless. Node-only wiring (raw mode, alt-screen) is separated from the pure core.

## Open refinements + deliberate "keep"s

- **Open:** a live theme consumer end-to-end; interactive status-panel (units → actions); a wcwidth-exact
  measure is already in (`string-width`); box borders + 2D nav are in.
- **Kept simple on purpose:** the interactive loop is a thin own loop over our Yoga tree (NOT Ink/React);
  the terminal renderer is not a full cell buffer (row segments suffice for non-overlapping flex layouts).

> See the plans `docs/superpowers/plans/2026-07-19-tui-layout-engine.md` +
> `-tui-interactivity.md` for the adopt-vs-build gates, and `docs/writeup-captures.md` for what to capture.
