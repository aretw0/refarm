# Research: UI composition guardrails — quality distributed by the design system (2026-07-02)

> Reference/influence + proposal, in the spirit of the peerd/Accordion research. The design system should
> distribute deterministic composition *quality*, not just tokens — so downstream sites (and the many
> screens AI agents generate) are first-class from the start, with a regression net grounded in reality.

## Motivation — a real gaffe

`apps/site` imports `@refarm.dev/ds` (tokens, verde-jardim theme, components) — good. But its hero
`<h1>` is a long sentence ("Refarm supplies the blocks downstream projects should not rebuild.") rendered
at the DS display size, so it dominates and overflows a small hero. The DS has a **contrast** test
(`packages/ds/src/contrast.test.ts`) but **no composition guardrail** — nothing catches an off-scale,
overflowing, or ill-fitting heading. Downstream, `vault-seed` hand-rolled truncation-with-cohesion in a
few spots: a per-consumer patch for what should be a DS primitive.

## The reframe

Quality composition should not be a downstream characteristic. The DS already owns the *constraints*
(type scale, color pairs, spacing); it should also own the *enforcement*. Then Refarm's own site, the
vault-seed template, and the works' POC screens are first-class from the start — quality by construction,
not by review.

## The common guardrails (research)

1. **Accessibility (axe-core / WCAG).** Contrast ratios [the DS has this], semantic HTML, ARIA, focus
   order, one-`h1` + heading hierarchy, alt text, landmarks. Deterministic rules over the DOM.
2. **Fluid type (`clamp()`).** Headings sized `clamp(min, vw-preferred, max)` never go fixed-huge; they
   scale with the viewport. The direct fix for the hero gaffe.
3. **Overflow detection.** `scrollWidth > clientWidth`, elements exceeding the viewport, clipped text —
   catches "big text in a small space." Needs a render (Playwright) or a heuristic.
4. **Measure / content-length.** A display heading should be short; long copy should step down the scale.
   A line-length band (≈45–75ch) and a heading-length-vs-size rule.
5. **Layout stability (CLS) / performance.** Lighthouse budgets, no layout shift.
6. **Visual regression.** Playwright/Percy snapshots — catches unintended visual change (a complement, not
   "quality" per se).
7. **Token-only enforcement.** Sizes/colors/spacing come from DS tokens; an off-scale font-size or an
   arbitrary color is a lint violation — so a "huge title" can't even be authored.

## The AI-generated-screen angle

Agentic UI generation produces many screens fast, and low quality is *evident* — poor contrast, overflow,
off-scale type, broken hierarchy, non-responsive. A deterministic, DS-backed guardrail is the regression
net for that: an agent (or a human) can't ship a screen that violates the DS's own constraints. This is
the emerging need the proposal targets.

## Proposal — a DS composition guardrail

`@refarm.dev/ds` grows a **composition guardrail** (design-lint) beside its tokens + contrast test:
deterministic checks a consumer runs against its rendered site (build output / DOM):

- **contrast** — the existing WCAG check, wired to run over a real page.
- **heading hierarchy** — one `<h1>`, no skipped levels, labelled landmarks.
- **fluid type** — headings use the DS `clamp()` scale, not fixed sizes; a heading that would overflow its
  container at the smallest breakpoint fails.
- **measure** — line-length within the DS band; a display heading over N chars steps down the scale.
- **token-only** — sizes/colors/spacing resolve to DS tokens (off-scale is a violation).

Rules are **data** (radically extensible — consumers add their own), but ship **first-class defaults** so
nobody starts from zero. Refarm's `apps/site` adopts it (the hero `h1` fails until fixed with a `clamp()`
+ a shorter display line). vault-seed converges its hand-rolled `site_ux_contract` / theme / responsive
checks onto it. The works' POC screens inherit the net.

## First slice — grounded in current reality

Start with the gaffes visible today, not a theory:

1. **The hero `h1`** → a fluid-type + overflow rule (the title must `clamp()` and fit its hero at the
   small breakpoint). This alone catches the published gaffe.
2. **Contrast** → run the existing `contrast.test.ts` over `apps/site`'s rendered pages.
3. Grow the rule set (hierarchy, measure, token-only) as more gaffes surface.

## Generic, not case-by-case (the consumer's key ask)

The guardrail must catch gaffes **generically** — every text/background pair's contrast (so strange
button colors surface without naming buttons), every element's overflow, every heading's scale — not a
list of specific assertions. Rules run over the **rendered DOM**, computed per element, so a new page or
component is covered for free.

## Inventory — vault-seed's current reality (the raw material)

vault-seed already hand-rolled UI checks; categorizing them shows the pattern to generalize and the
anti-pattern to retire:

- **Generic seed (keep + generalize):** `smoke_responsive.mjs` renders with Playwright and measures
  overflow / bounding boxes generically (`scrollWidth`, `boundingBox`, ~16 overflow checks) — exactly the
  render-and-measure the guardrail needs. Extend it from overflow to all rules.
- **Contrast seed (keep + generalize):** `check_theme.js` + `notebook_chart_contrast` compute WCAG
  contrast — but over tokens / specific spots, not every rendered text/background pair. Generalize to the
  whole DOM (this is what would catch the strange-colored buttons).
- **Anti-pattern (converge away):** `site_ux_contract.test.mjs` holds **~243 source-inspecting
  assertions** (read a file, assert it contains a literal pattern) — per-case, brittle (it broke on our
  own refactors), the opposite of generic. These should collapse into a handful of DS-lint rules.

The raw material exists downstream but partial + hand-rolled; the DS should own it, generalize it, and
distribute it. The first rules are literally the gaffes we can already see (button contrast, hero
overflow) — a regression net grounded in reality, not theory. Studying the state of the art (axe-core,
Lighthouse a11y, fluid-type systems, and emerging AI-UI linters) is an ongoing input as the rule set
grows.

## Adjacent influences — scoped, not folded into one narrative

Several references arrived together from the vault-seed consumer. Only **one** directly feeds *this*
guardrail; the others are influences for **different specific points**. They are placed here honestly so
none is lost and none is over-attributed to "screen verification" — design verification is one concern
among several, not the frame for all of them.

**Directly feeds this guardrail:**

- **`JCarterJohnson/vibecoded-design-tells`** — mines 3.2M posts for visual patterns that read as
  AI/"vibe-coded": shadcn/Tailwind defaults, "AI purple" gradients, gradient hero text, neon glow,
  emoji-as-icons, centered-hero-plus-three-cards — ranked by frequency, with a `devibe_scan.py` scanner.
  A ready **rule catalog** for a second, heuristic tier, and honestly `apps/site`'s hero sits near
  several, so it would flag *our own* surface first.

So the guardrail has **two tiers**: (1) objective quality (deterministic — contrast over every rendered
pair, overflow, hierarchy, fluid type, token-only); (2) tell detection (heuristic, prioritized warnings
from the vibecoded catalog). One design principle carries over from `samasante/liquid-glass`: **a tell is
low *effort*, not a banned effect** — tier 2 flags cheap default execution (unaccessible `backdrop-blur`),
not the effect's name; the check is execution quality (accessibility, performance).

**Adjacent, NOT part of this guardrail** — each placed in its own home, not folded into this discourse:

- `blader/humanizer` — **text** quality (a taxonomy of writing tells). A separate front, served in its own
  domain, not a screen check.
- `samasante/liquid-glass`, `humation-labs/humation` — **owned UI primitives** (a DS *asset* front,
  long-term) →
  [`2026-07-02-external-reference-owned-ui-primitives.md`](./2026-07-02-external-reference-owned-ui-primitives.md).

## Boundary

Refarm owns the DS + the guardrail (the quality primitive, distributed). Consumers (vault-seed, POCs)
*run* it against their site; they own their content, not the quality rules. This is quality distributed by
the ecosystem, the same way `records:v1` / `credentials:v1` distribute capability.

## Flagged by

vault-seed (2026-07-02), on seeing the published `apps/site` hero title dominate its space — and
recognizing that vault-seed's own hand-rolled truncation/cohesion checks belong upstream in the DS, so
every consumer inherits them instead of re-solving them.
