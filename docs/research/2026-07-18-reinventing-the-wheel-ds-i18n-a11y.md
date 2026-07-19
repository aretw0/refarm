# Reinventing the Wheel? — DS tokens, i18n, a11y, conversation model, schema-forms

**Date**: 2026-07-18 | **Status**: Research consolidated (verdict) | **Scope**: `@refarm.dev/ds`, messenger substrate, cross-surface projection

> Consolidation of two deep-research runs (~102 and ~105 subagents each) that fanned
> out, fetched authoritative sources, and adversarially verified claims. Both runs hit
> the session limit **at the synthesis step**, so the written verdict was never produced
> live. This document reconstructs the verdict from the surviving **verified claims** and
> grounds it in refarm's *actual* DS/messenger code. Raw run outputs were ephemeral
> (`/tmp/.../tasks/{wk7ly3pz7,wx1xv0h0c}.output`); their substance is captured here.

## Provenance & confidence

| Run | Question | Fan-out + verify | Synthesis | Surviving evidence |
|-----|----------|------------------|-----------|--------------------|
| **A** `wk7ly3pz7` | chat/conversation model · i18n · a11y · schema-forms | ✅ 25 claims → **21 confirmed, 4 refuted** | ✅ **completed** | Full findings + caveats + open questions |
| **B** `wx1xv0h0c` | design system + multi-surface component library | ✅ 25 claims → **19 confirmed, 1 refuted, 5 no-verdict** | ❌ **failed** (session limit) | 19 verified claims, no written verdict |

Every claim below carries an adversarial vote (e.g. `3-0` = 3 verifiers confirmed, 0 refuted).
Sources marked *primary* are the spec/vendor docs themselves.

---

## The one thing to internalize first

Refarm's `@refarm.dev/ds` **independently arrived at the architecturally correct model** and it
is real code, not aspiration:

- `ThemeRegistry` — "a theme is a **surface-neutral** map of semantic tokens (`ds-tokens:v1`),
  declared **once**; each renderer projects it to its surface — web → CSS custom properties
  (`tokens.css`), a TUI → terminal colors."
- `projectThemeToTui(theme)` — projects a `DsTheme` object → truecolor + ansi256 + ansi16.
- Plugin theme packs are already **token JSON** (`{ id, theme|tokens }`).
- Token **contract + conformance** (`REQUIRED_TOKENS`, 30 semantic shadcn-aligned, unprefixed
  names, scoped under `[data-refarm-theme]`, never bare `:root`).

This is the same "declare once → project to many surfaces" pattern that Meta's **React Strict
DOM** proves for web+native and **Zag.js** proves for logic+adapter. So the headline is *not*
"you are reinventing and trapped in CSS." It is: **you built the right architecture; the
adoptions below are narrow, high-leverage upgrades to the authoring source and the transform
engine — not a rewrite.**

---

## Verdict B — Design system & multi-surface library

Ranked by long-term payoff.

### 1. Design tokens — ADOPT DTCG as the *source*, KEEP the per-surface projection · **highest payoff**

**Verdict: ADOPT** the W3C DTCG format + Style Dictionary as the *token source & transform
engine*; **KEEP-AUTHORING** the per-surface projection (esp. the TUI/ANSI transform, which no
off-the-shelf tool does).

Verified evidence:
- DTCG is a vendor-neutral, **platform-agnostic** standard file format whose explicit purpose
  is tool interoperability (`designtokens.org/tr/drafts/format`, 3-0). Tokens are defined
  "platform-agnostic … so they can be shared across different disciplines, tools, and
  technologies" (3-0) — the standard is *designed* against CSS-coupling.
- DTCG reached its **first stable, production-ready version (2025.10)** in Oct 2025 — a citable
  target, not a moving one (w3.org design-tokens announcement, 3-0). "One token file generates
  platform-specific code for iOS, Android, web, and Flutter" (2-1).
- Reference implementations exist **today** in Style Dictionary, Tokens Studio, Terrazzo (3-0).
- **Style Dictionary v4 has first-class DTCG support** (`styledictionary.com/info/dtcg`, 3-0)
  and is **forward-compatible** — adopting it does not force abandoning the legacy format (3-0).
  Its core purpose: "transform a single token definition for use across different platforms,
  languages, and contexts" (3-0) — exactly refarm's web/TUI/agent need.
- Tokens Studio explicitly supports DTCG as "the direction the ecosystem is moving" (3-0).

The *narrow* gap in refarm (this is the actual trap, made precise):
- Built-in themes are authored as **`.css` files** (`themes/tractor-green.css`), and the
  surface-neutral `DsTheme` is **reverse-extracted from CSS by regex** (`theme-css.test.ts`).
  So for built-ins the CSS is the de-facto source and the "neutral" JSON is derived — the
  inverse of the intended direction.
- `parseColorToRgb` handles only `#hex`/`rgb()` and **silently drops** `hsl/oklch/color-mix`,
  so a modern-color theme loses those tokens in the TUI projection.

The fix (surgical, not a rewrite): author themes as **`tokens.json` (DTCG)** → Style Dictionary
*emits* `tokens.css` (unchanged for web consumers) **and** a resolved `DsTheme` JSON. The
bespoke `projectThemeToTui` (ansi256/ansi16 downsample) stays — wrap it as a custom Style
Dictionary format/transform. Keep the semantic names, the scoping discipline, and the
conformance contract (it now validates the DTCG source). This closes the memory note
`tema-geral-multi-superficie` ("DsTheme acoplado CSS") at the root.

> **LANDED (2026-07-19).** Implemented in `@refarm.dev/ds`: DTCG source
> (`src/tokens/*.tokens.json`) → a thin in-repo emitter generates the byte-identical
> `themes/*.css` + `BUILTIN_THEMES` (`DsTheme` objects for TUI/agent). Refinement earned by
> measuring the code: refarm's CSS is bespoke (`@layer ds.theme` + white-label dual selector +
> modes), so the local emitter owns the web CSS + `BUILTIN_THEMES` while **Style Dictionary owns
> the platform exports** (SCSS, iOS/Swift, Android/XML, Flutter/Dart) it does best — transforming
> colors to each platform's native type. Both read the one DTCG source. So refarm's DS now
> distributes to any platform, not just web. Plan:
> `docs/superpowers/plans/2026-07-19-ds-dtcg-token-source.md`.

### 2. Headless primitives — LEARN-FROM Zag's machine+adapter; KEEP structural, don't hand-roll the hard widgets

**Verdict: KEEP-AUTHORING** structural primitives (card, transcript, hub/layout, form-from-schema);
**LEARN-FROM** Zag.js's state-machine + connect/adapter split as the reference for our
transport×renderer axis; **ADOPT Zag machines specifically** if/when refarm builds the hard
interactive widgets (combobox, listbox, dialog, menu, date-picker) — do **not** hand-roll those.

Verified evidence:
- Zag.js models UI logic as **framework-agnostic finite state machines** in plain JS, consumable
  in React/Vue/Solid/Svelte (`zagjs.com`, 3-0) — the closest match to refarm's non-React surfaces.
- It **separates logic/state from presentation** via a connect/adapter step; machines are
  headless/unstyled (3-0), and **bake WAI-ARIA compliance** in via adapters that map machine
  output to DOM semantics (3-0).

Honest reading: the a11y/i18n-maintenance-trap is **real for the hard interactive web widgets**
(the APG keyboard/focus/aria matrix is genuinely hard and evolving) — but refarm's primitives so
far are mostly *structural*, where authorship is fine. React Aria is the richest a11y+i18n but is
**React-coupled**, wrong for a multi-surface framework.

⚠️ Under-evidenced: several Zag verification votes **errored on the session limit**, and React
Aria's specific i18n strengths (`@internationalized/date`, RTL) did **not** survive into the
confirmed set. The Zag-vs-React-Aria i18n head-to-head is not settled here — see next-pass.

### 3. Cross-surface architecture — KEEP-AUTHORING; web+TUI+agent is genuinely novel

**Verdict: KEEP-AUTHORING.** Our transport×renderer axis matches proven architecture; the
web+TUI+**agent-as-tool** triple is territory no verified player occupies.

Verified evidence:
- **React Strict DOM** (Meta) proves "one styled component definition → web AND native" via a
  **strict compatibility layer between renderers, not replacing either** (3-0 / 2-1) — directly
  analogous to transport-vs-renderer separation. A single `html.div` projects to web `<div>` and
  native `<View>` automatically (2-0).
- But every proven cross-surface player does **web+native** (RSD, Tamagui, RN-Web) or
  **terminal-only** (Ink, Textual). **None** does web+TUI+agent-as-a-tool from one definition.
  The agent surface (a capability projected as an LLM tool) is unserved by any DS/cross-surface
  library — refarm's genuine authorship territory.
- ✗ **Refuted (0-3)**: "StyleX powers RSD's cross-surface styling." Do **not** build on that
  assumption.

Borrow from RSD: the "strict shared contract + thin per-surface adapter" discipline.

### 4. Distribution/authoring model — KEEP-AUTHORING; refarm *is* the shadcn model, extended to multi-surface

**Verdict: KEEP-AUTHORING.**

Verified evidence:
- shadcn/ui is **explicitly NOT an installed dependency** — it hands you the source to own and
  edit directly (`ui.shadcn.com/docs`, 3-0). Its philosophy is **"Open Code"**: edit the
  component directly rather than override/wrap (3-0).

This is the exact philosophical match for refarm's authorship stance, and `.ds-*` + semantic
tokens + copy-into-your-app already mirror it. The evolution to name explicitly:
**shadcn = own your code, over accessible primitives you don't reinvent, for one surface (web).
Refarm = own your *capability*, over primitives you don't reinvent (Zag-style machines / Intl /
ARIA), across *many* surfaces.** The research's named sweet spot — "own your components, don't
reinvent the accessible/i18n primitives underneath" — is precisely refarm's target.

---

## Verdict A — chat/conversation · i18n · a11y (run A synthesized this live)

### i18n
- **ADOPT `Intl.RelativeTimeFormat` with `numeric:"auto"`** for Hoje/Ontem/Amanhã day labels
  (3-0). It natively emits locale-correct `hoje`/`ontem`/`amanhã` from CLDR — refarm's
  hand-rolled pt-BR labels duplicate a Baseline Web-platform primitive. **Scope**: the API only
  turns an integer offset into a label — the timezone-aware day-bucketing, the full-date fallback
  for older messages, and header capitalization remain legitimate authorship. **Lowest-effort /
  highest-payoff change identified.**
- **LEARN-FROM / ADOPT-on-trigger ICU MessageFormat** (FormatJS / `intl-messageformat`) for
  plurals, gender/select, ordinals (3-0). Native `Intl` cannot express these; ICU **composes on
  top of** Intl (delegates to `Intl.NumberFormat`/`DateTimeFormat`/`PluralRules`), so it does not
  replace the foundation. Staying Intl-only is fine **today** for a single locale with no
  pluralized strings; the **trigger** is the first plural/gendered string or the second locale.
  ⏳ Watch **MF2** (TC39 native `Intl.MessageFormat`, Unicode Final Candidate 2025, **not yet
  shipped**) before hard-committing to a userland lib.

### a11y
- **ADOPT `role="log"`** on the transcript container (3-0). Refarm's bare `aria-live="polite"` is
  at the right politeness level but is **missing the canonical container** that W3C technique
  **ARIA23** ("Using role=log …", chat is its flagship example) and MDN designate for chat/message
  history. `log` supplies polite announcement implicitly **plus append-only sequential semantics**
  a generic live region can't express. **Belt-and-braces**: keep the explicit `aria-live`
  alongside `role="log"` — SR support for *implicit* live regions is inconsistent (the one 2-1
  dissent).
- **LEARN-FROM the `feed` pattern** (role=article + `aria-posinset`/`aria-setsize` + `aria-busy`)
  for scrollback browsing (3-0) — but ✗ **refuted (0-3)**: feed is **NOT** the live-announce
  container (that's `log`), and feed's reading-mode focus obligation was **not** upheld.
  `role="separator"` for day dividers is OK but insufficient *alone* (container still needs `log`).

### Conversation model — KEEP-AUTHORING neutral model, LEARN-FROM Matrix invariants (3-0)
Copy these invariants: single `m.room.message` event with a **msgtype discriminator**;
**per-event sender identity** (stable user id); **edits as `m.replace` relations, not in-place
mutation** (renderer resolves replacements); **state-vs-timeline event separation**; **rich-text
fallbacks** for graceful degradation of forms/cards/tool-calls in a transcript.
✗ **Refuted (0-3)**: Matrix is **NOT** a strict 1:1 action-to-event log — do not overclaim
event-sourcing purity.

### Long histories — ADOPT DOM virtualization, reconcile with `role="log"`
Stream's `VirtualizedMessageList` is the mature-vendor answer for high-volume channels (3-0).
**Tension (unresolved by the evidence)**: windowing unmounts off-screen messages → they leave the
accessibility tree and find-in-page, which fights the `role="log"` live-region path. Adopt
windowing for scale, but design the SR/live-announce path deliberately around it.

---

## The single genuine gap → the complementary pass worth running

**Schema-driven forms** is unresolved in *both* runs: run A returned **zero** surviving claims on
rjsf / JSONForms / Microsoft Adaptive Cards / Vercel AI SDK generative UI; run B's question did
not cover it. This is directly load-bearing — refarm derives inline forms from typed-arg →
JSON-Schema → agent/capability tool schemas (the pattern-B dogfood + me-chat form in flight), and
the cross-surface angle (a form derived from an agent tool schema, rendered web+CLI+agent) is
exactly where refarm may be *genuinely novel* vs. reinventing.

A targeted pass should answer: is typed-arg→JSON-Schema→form derivation reinvention or justified
authorship; what do rjsf/JSONForms solve that we'd re-solve; does Adaptive Cards' host-agnostic
card model or Vercel generative UI already cover the agent surface; and can any of them project to
CLI/agent, or is cross-surface derivation genuinely unserved. Optionally fold in the
under-evidenced **Zag-vs-React-Aria i18n** head-to-head from run B if we intend to commit hard to
a primitive strategy.

## Open questions carried forward
- Reconciling DOM virtualization with `role="log"` live announcements (no vendor answer surfaced).
- Migration trigger/target off Intl-only to an ICU catalog (2nd locale vs. 1st plural), and which
  lib (FormatJS vs i18next vs Lingui) fits TS+multi-surface — with MF2 on the horizon.
- Run both `role="feed"` (scrollback) *and* `role="log"` (live tail), or one container?

## Landing points (where these adoptions go)
- `role="log"` + `Intl.RelativeTimeFormat` → messenger substrate → `apps/me` + the `/conversa`
  faces in T1/T2/T3 (tiny, in-flight surface).
- DTCG token source + Style Dictionary emit → `@refarm.dev/ds`; the generic refarm win that also
  lets the T-examples theme across web+TUI.
- SERPRO/EFD/ALM framing stays in **T3 only**; the rest stays agnostic and refarm assimilates any
  specifics as generic.
