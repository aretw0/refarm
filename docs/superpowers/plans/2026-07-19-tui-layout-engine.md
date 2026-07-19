# TUI Layout Engine — Plan (for approval)

> **Status: DRAFT for approval.** From the TUI-composition verdict in
> `docs/research/2026-07-18-reinventing-the-wheel-ds-i18n-a11y.md` (§ "TUI composition — converge
> internal + external effort"). Requested by Arthur: serve TUI composition the way DTCG + Style
> Dictionary served tokens — converge with proven external effort, plan-first before code.

**Goal:** Give refarm's terminal surface a **layout engine** — the missing half of TUI composition.
Today `projectThemeToTui` (`@refarm.dev/ds`) handles the COLOR half (tokens → ANSI), and
`surface-terminal` projects a surface, but there is **no flex layout** (rows/columns, gap, padding,
wrap, alignment). To compose a TUI from the SAME surface-model the web uses — and reach richer than
a flat list — we need flex-in-the-terminal, adopting a proven engine instead of hand-rolling box math.

---

## The decision to confirm

**ADOPT a layout engine for the terminal renderer; the current renderer is TS, so the fit is Yoga
(`yoga-layout`, Facebook's flexbox — the same engine Ink uses). taffy is the Rust-surface equivalent,
for if/when a Rust TUI renderer lands.** Authorship stays on the two parts an engine does NOT do:
the **text measurement** (terminal cell width — wcwidth/unicode, wrapping, truncation) fed to Yoga as
a measure function, and the **projection** (surface-model → layout tree, positioned boxes → ANSI paint
via `projectThemeToTui`). This is exactly the DTCG+Style-Dictionary shape: one source (the
surface-model), an adopted engine for the hard generic math (flex), bespoke code only where refarm is
genuinely unserved (terminal text metrics + the web+TUI+agent projection).

**Right-size first (honest gate).** The verdict said ADOPT-*candidate*, not ADOPT. Before pulling in a
WASM dep, Task 0 assesses whether the terminal surface's REAL composition needs justify a flex engine
(multi-region panes, wrapping cards, aligned columns) or whether a lighter hand-rolled primitive
suffices for today's flat lists. If the need is simple, we stop at a small layout helper and revisit
Yoga when a rich TUI face actually demands it. No speculative dependency.

---

## Architecture (if the need justifies it)

One source, per-surface layout — the invariant, extended from tokens to LAYOUT:

```
surface-model (declared once)  ──►  web renderer: CSS flexbox
                               └─►  TUI renderer: layout tree ─► Yoga (flex math) ─► positioned boxes ─► ANSI paint
```

Modules:
- `computeTuiLayout(node, opts): PositionedNode` — wraps Yoga: build a Yoga tree from a flex `LayoutNode`
  (flexDirection, width/height/flex, padding, gap, align/justify), attach a **measure function** for
  text leaves (terminal cell width, not px), `calculateLayout()`, read back `{x, y, width, height}` per
  node. PURE given the measure fn.
- `renderTuiLayout(positioned, theme): string` — paint the positioned boxes to an ANSI string grid:
  text placed at `(x, y)`, clipped/wrapped to its box, colored via `projectThemeToTui(theme)`. The
  bespoke terminal-rendering half.
- `surfaceModelToLayout(model): LayoutNode` — map the existing `tuiSurfaceModel` (capabilities) to a
  flex layout tree. The projection.

Division of labour (mirrors tokens): **Yoga owns flex math** (generic, hard, solved); **refarm owns
text measurement + the surface→layout→ANSI projection** (terminal-specific, genuinely unserved).

---

## Tasks

### Task 0 — Right-size the need (gate) — ✅ DONE: Yoga NOT warranted yet
- [x] Inventory: `surface-terminal/tui-runtime.ts` `renderMenu` is a **flat, single-column line menu**
  — sections as bold headings, items as numbered rows (`  <idx>  <name><hint>  <summary>`), a footer
  hint. No multi-region panes, no wrapping cards, no aligned tables, no box borders. `tuiSurfaceModel`
  is `projectSurface(surfaceModel, "tui")` — the same sections/items model, rendered as that list.
- [x] **Decision: DO NOT adopt Yoga now** — a WASM flex engine for a flat line menu is premature
  (exactly what this gate guards). Land a **minimal, dependency-free column-align helper** (the one real
  deficiency: `summary` columns don't align because item names vary in width) and **record the trigger**
  to revisit Yoga: *a TUI face that needs multi-region panes, wrapping cards, or aligned multi-column
  tables*. Tasks 1–4 (Yoga adoption) are **deferred** until such a face exists. This keeps the reusable
  terminal-text-measurement idea alive without a speculative dependency.

### Task 1 — Adopt Yoga, deterministically (TDD)
- [ ] Validate the dependency the pnpm-11 way FIRST: does `yoga-layout` trip `ERR_PNPM_IGNORED_BUILDS`
  under the pinned pnpm 11? It ships prebuilt WASM/asm.js — confirm; if it has a build script, add it
  to `allowBuilds` in `pnpm-workspace.yaml` (see the CI-hardening memory). Regenerate lockfile with the
  pinned pnpm.
- [ ] `computeTuiLayout`: a Yoga wrapper + a terminal measure function. Unit test: a flex row of two
  fixed-width boxes computes the expected x/y/w/h; a column stacks; padding/gap offset children;
  align/justify place them. Async Yoga init handled once (module-level `await loadYoga()`), Node-safe.

### Task 2 — Render positioned boxes to ANSI (TDD)
- [ ] `renderTuiLayout(positioned, theme)`: paint text into its box (wrap/truncate by cell width),
  color via `projectThemeToTui`. Unit test: snapshot the ANSI grid for a known layout; assert text
  lands in the right cells and colors come from the theme (no invented ANSI).

### Task 3 — Project a real surface-model (TDD)
- [ ] `surfaceModelToLayout` + wire a real capability surface-model → layout → render. Test: the SAME
  `tuiSurfaceModel` a web face uses renders a laid-out terminal view — proving "declare once → web CSS
  flex + TUI Yoga flex, one layout semantics." This is the payoff, analogous to the multi-platform
  token demo.

### Task 4 — (optional, own slice) interactivity
- [ ] Focus/keyboard/input for interactive TUI widgets — LEARN-FROM Textual/ratatui; a hard interactive
  widget is where authorship cost is real (mirror proven behavior, don't invent). Deferred to its own
  plan unless a face needs it.

---

## Risks / open questions
- **Text measurement is refarm's job, not Yoga's.** Yoga needs a measure function; terminal cell width
  (wide CJK, emoji, zero-width) is the bespoke part. Get it wrong and layout drifts. Reuse a
  wcwidth-style measure; test with wide/zero-width chars.
- **WASM/async init + pnpm 11 build scripts.** `yoga-layout` loads WASM asynchronously — init once,
  Node-safe. Validate build-script behavior against the pinned pnpm 11 (the style-dictionary lesson).
- **Premature-adoption risk.** Task 0 is a real gate — do not pull a WASM dep for flat lists.
- **White-label.** The layout primitive is brand-agnostic (LayoutNode/PositionedNode, no `refarm`
  names) — keep it so.
- **Scope creep vs. the web renderer.** Keep the layout tree surface-neutral so the web renderer could
  later share the SAME `surfaceModelToLayout` (CSS flex maps 1:1), not a TUI-only fork.

## Self-review
- Grounded in the verdict (ADOPT-candidate) + honest right-sizing (Task 0 can stop the plan).
- Same shape as the landed token pipeline: standard source (surface-model) + adopted engine (Yoga) for
  the generic hard math + bespoke authorship only where genuinely unserved (terminal metrics +
  projection).
- Dependency risk handled with the hard-won pnpm-11/allowBuilds discipline up front.
- No code until Arthur approves; Task 0's assessment may itself change the scope.
