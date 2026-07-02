# Design-Tells Catalog — the `design-tells` checker's initial rule data

**Purpose:** the initial rule set the `ui`-domain `quality:v1` checker (`design-tells`) ships, expressed as
`QualityRule` data. Rules are **data** (matcher-is-data): the checker interprets each rule's `check.type`
against a serialized DOM the host provides. This catalog is the design of that data + the `check.type`
vocabulary; the checker implementation turns it into logic. Companion to
[`2026-07-02-ui-composition-guardrails.md`](./2026-07-02-ui-composition-guardrails.md).

## `check.type` vocabulary (ui domain)

The host serializes the rendered page (DOM + computed styles / accessibility tree) and hands it to the
checker as `subject::dom(...)`. Each rule's `check` object names a matcher the checker implements:

| `check.type` | params | what it flags |
|---|---|---|
| `contrast` | `min` (ratio, default 4.5) | any rendered text/background pair below `min` (WCAG) |
| `overflow` | — | any element whose `scrollWidth > clientWidth` or that exceeds the viewport |
| `heading-hierarchy` | — | more than one `<h1>`, a skipped heading level, or an unlabelled landmark |
| `fluid-type` | — | a heading with a fixed font-size (not a `clamp()`/token) that overflows at the min breakpoint |
| `measure` | `maxCh` (default 75) | a text block whose line length exceeds `maxCh` |
| `token-only` | `props` (e.g. `["font-size","color"]`) | a value on `props` not resolving to a DS token |
| `tell-pattern` | `pattern` (named) | a heuristic "vibe-coded" signature (tier 2) |

## Tier 1 — objective quality (deterministic, `fail`/`warn`)

```jsonc
[
  { "id": "contrast-aa", "severity": "fail", "category": "a11y",
    "description": "Text/background contrast must meet WCAG AA (4.5:1).",
    "check": { "type": "contrast", "min": 4.5 } },

  { "id": "no-overflow", "severity": "fail", "category": "layout",
    "description": "No element may overflow its container or the viewport.",
    "check": { "type": "overflow" } },

  { "id": "heading-hierarchy", "severity": "warn", "category": "structure",
    "description": "One h1, no skipped heading levels, labelled landmarks.",
    "check": { "type": "heading-hierarchy" } },

  { "id": "fluid-headings", "severity": "warn", "category": "type",
    "description": "Headings scale fluidly (clamp/token), never a fixed size that overflows small screens.",
    "check": { "type": "fluid-type" } },

  { "id": "measure", "severity": "warn", "category": "type",
    "description": "Line length stays within a readable measure (~45-75ch).",
    "check": { "type": "measure", "maxCh": 75 } },

  { "id": "token-only-size-color", "severity": "warn", "category": "tokens",
    "description": "Font sizes and colors resolve to design-system tokens, not arbitrary values.",
    "check": { "type": "token-only", "props": ["font-size", "color", "background-color"] } }
]
```

## Tier 2 — tell detection (heuristic, `info`, prioritized)

Ranked by the community-frequency signal (`vibecoded-design-tells`). These are **warnings**, not hard
failures — the ecosystem's "does this look AI-made?" nudge. A premium effect done well is not a tell (see
the liquid-glass nuance in the guardrail research): these flag the *cheap default* execution.

```jsonc
[
  { "id": "tell-ai-purple", "severity": "info", "category": "tell",
    "description": "Unprompted violet/magenta 'AI purple' gradient palette.",
    "check": { "type": "tell-pattern", "pattern": "ai-purple-gradient" } },

  { "id": "tell-gradient-hero-text", "severity": "info", "category": "tell",
    "description": "Large heading text filled with a gradient.",
    "check": { "type": "tell-pattern", "pattern": "gradient-hero-text" } },

  { "id": "tell-neon-glow", "severity": "info", "category": "tell",
    "description": "Unprompted neon/luminescent glow effects.",
    "check": { "type": "tell-pattern", "pattern": "neon-glow" } },

  { "id": "tell-emoji-icons", "severity": "info", "category": "tell",
    "description": "Emoji used in place of a real icon set.",
    "check": { "type": "tell-pattern", "pattern": "emoji-as-icon" } },

  { "id": "tell-centered-hero-three-cards", "severity": "info", "category": "tell",
    "description": "The stock centered-hero-plus-three-cards template composition.",
    "check": { "type": "tell-pattern", "pattern": "centered-hero-three-cards" } },

  { "id": "tell-untouched-defaults", "severity": "info", "category": "tell",
    "description": "Component-library (shadcn/Tailwind) defaults used without customization.",
    "check": { "type": "tell-pattern", "pattern": "untouched-library-defaults" } }
]
```

## Profiles

- `design-default` — Tier 1 only (objective quality; the release gate for any consumer site).
- `design-strict` — `extends: design-default` + Tier 2 (adds the tell warnings).

## Notes for the checker implementation

- Tier 1 needs computed styles + geometry; the host provides them in the serialized subject (the checker
  stays pure — see `plugin-security-model.md`, the minimal-capability checker).
- `tell-pattern` matchers are the fuzziest; ship the high-frequency ones first (ai-purple, gradient-hero,
  emoji-icons) and grow the set as real gaffes surface — a regression net grounded in reality, not theory.
- The companion **text-tells** catalog already exists downstream as `quality-rules.json` `riskPatterns`
  (regex rules); it conforms to the same `QualityRule` envelope with `check.type: "regex"`.
