# Spec: Refarm DS Token Contract (Roadmap Item 4a)

**Status:** DRAFT — ready for implementation
**Authors:** Arthur Silva
**Date:** 2026-06-25
**Related:** `docs/CONVERGENCE_ROADMAP.md` (item 4), `docs/APPS_REFARM_PROMOTION_LEDGER.md`, `docs/ECOSYSTEM_SUPPLY_MAP.md`, `ADR-069` (npm scope)

---

## Context & Motivation

`@refarm.dev/ds` is the one nascent UI block (the audit, item 2, confirmed `homestead`/
`dispatch-surface` are already mature). Today `ds/tokens.css` is `--refarm-*` namespaced
variables, a single dark theme with hardcoded hex, plus a few headless utility classes.

Meanwhile the `vault-seed` consumer already proved a richer model in `.site/styles/`: a
shadcn/ui semantic token set (`--background`, `--foreground`, `--primary`, `--card`, `--popover`,
`--muted`, `--accent`, `--border`, `--input`, `--ring`), Tailwind v4 `--color-*` aliases, **three
named themes** (`oceano`, `terracota`, `verde-jardim`), runtime theme switching
(`theme-runtime.css`), and dark mode.

Decision (owner, 2026-06-25): grow `ds` as a **token contract** (the Refarm idiom: contract +
reference + third-party implementations), and **absorb the vault-seed lessons** — "se for bom
para todos, pegamos" (the convergence promotion rule). Each side contributes its proven half:

| From `vault-seed` (adopt) | From `refarm ds` (keep) |
|---|---|
| Semantic shadcn token names | Collision-safe scoping (the shadow-DOM lesson) |
| Multi-theme model + runtime switch + dark mode | Primitives `vault-seed` lacks: radius, shadow, glass, typography, feedback colors |
| Tailwind v4 `--color-*` bridge | "Tractor Green" brand as the reference theme |

## Decisions

1. **The contract is the semantic token set.** `@refarm.dev/ds` exports the canonical variable
   names and their semantics. A "theme" is any set of values that defines all required variables.
2. **Naming:** semantic, shadcn-aligned, unprefixed (`--background`, not `--refarm-background`) so
   consumers and Tailwind v4 (`--color-*`) work without translation.
3. **Scoping (anti-collision):** themes apply under a scope selector — `[data-refarm-theme]` (and
   `@layer refarm.tokens`) — **not raw `:root`** — so injecting `ds` into any host/surface does not
   leak or collide. This carries the existing `--refarm-*` collision-safety into the semantic
   model and respects the lab shadow-DOM lesson (scope, don't force global).
4. **Reference theme:** "Tractor Green" (the current `ds` brand palette), expressed in the new
   semantic names. Dark mode via `[data-refarm-theme][data-mode="dark"]`.
5. **Preset themes:** `oceano`, `terracota`, `verde-jardim` ship as conforming example themes
   (lifted from `vault-seed`), proving the contract supports more than the brand.
6. **Theme conformance:** ship `runDsThemeConformance(theme)` — verifies a theme defines every
   required contract variable. The Refarm contract idiom applied to tokens.
7. **Primitives stay in the contract:** radius (`--radius-sm/md/lg`), shadow, glass, typography
   (`--font-sans/mono`), and feedback (`--error/--warning/--success/--info`) remain part of the
   contract — `vault-seed`'s color-only set did not cover these.

## 1. Token contract surface (`packages/ds/src/contract.ts`)

```ts
export const DS_TOKEN_CAPABILITY = "ds-tokens:v1" as const;

/** Required semantic variables every conforming theme MUST define (without the leading `--`). */
export const REQUIRED_TOKENS = [
  // surfaces
  "background", "foreground",
  "card", "card-foreground",
  "popover", "popover-foreground",
  "muted", "muted-foreground",
  // intent
  "primary", "primary-foreground",
  "secondary", "secondary-foreground",
  "accent", "accent-foreground",
  // lines & focus
  "border", "input", "ring",
  // feedback
  "error", "warning", "success", "info",
  // primitives
  "radius-sm", "radius-md", "radius-lg",
  "shadow-sm", "shadow-md", "shadow-lg",
  "font-sans", "font-mono",
] as const;

export type DsToken = (typeof REQUIRED_TOKENS)[number];
export type DsTheme = Record<DsToken, string>;

export interface DsThemeConformanceResult {
  pass: boolean;
  total: number;
  failed: number;
  missing: DsToken[];
}
```

## 2. CSS shape (`packages/ds/src/`)

```
src/
  contract.ts            # REQUIRED_TOKENS, types (above)
  conformance.ts         # runDsThemeConformance(theme: Partial<DsTheme>)
  conformance.test.ts
  tokens.css             # @layer refarm.tokens — variable declarations under [data-refarm-theme]
  themes/
    tractor-green.css    # reference theme (refarm brand) + [data-mode="dark"] block
    oceano.css           # preset (from vault-seed)
    terracota.css        # preset
    verde-jardim.css     # preset
  tailwind-bridge.css    # maps --color-* → semantic vars for Tailwind v4 consumers
  index.ts               # re-exports contract + conformance; documents CSS entry points
```

`tokens.css` (illustrative shape):
```css
@layer refarm.tokens {
  [data-refarm-theme] {
    /* contract variables — values come from the active theme file */
    --background: var(--_bg);
    --foreground: var(--_fg);
    /* ...all REQUIRED_TOKENS... */
  }
}
```

Themes set the concrete values under the same scope, e.g. `tractor-green.css`:
```css
@layer refarm.theme {
  [data-refarm-theme="tractor-green"] {
    --background: #0d1117;
    --foreground: #c9d1d9;
    --primary: #238636;
    --primary-foreground: #ffffff;
    /* ...every REQUIRED_TOKEN... */
    --radius-md: 8px;
    --shadow-md: 0 4px 8px rgba(1, 4, 9, 0.3);
    --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  [data-refarm-theme="tractor-green"][data-mode="dark"] { /* dark overrides */ }
}
```

## 3. Conformance (`src/conformance.ts`)

```ts
import { REQUIRED_TOKENS, type DsToken, type DsTheme, type DsThemeConformanceResult } from "./contract.js";

export function runDsThemeConformance(theme: Partial<DsTheme>): DsThemeConformanceResult {
  const missing = REQUIRED_TOKENS.filter(
    (t) => typeof theme[t] !== "string" || theme[t]!.trim().length === 0,
  ) as DsToken[];
  return {
    pass: missing.length === 0,
    total: REQUIRED_TOKENS.length,
    failed: missing.length,
    missing,
  };
}
```

`conformance.test.ts` parses each shipped theme CSS (or imports a JS theme object) and asserts
`runDsThemeConformance(theme).pass === true` for `tractor-green`, `oceano`, `terracota`,
`verde-jardim`; and asserts a deliberately-incomplete theme reports the exact `missing` tokens.

## 4. Consumer re-consumption (`vault-seed`)

- `vault-seed/.site/styles` migrates: import `@refarm.dev/ds/tokens.css` + the chosen theme,
  drop the locally-defined contract variables, keep `oceano`/`terracota`/`verde-jardim` (now as
  conforming `ds` themes — contributed upstream).
- The `dgk serve` admin UI (`packages/cli/src/commands/serve.js`, an inline `ADMIN_HTML` string)
  switches its `<style>` to the same tokens — this is the seam into item 4b (recompose the admin
  UI from `homestead` primitives, which already consume `ds`).
- `theme-runtime.css` (vault-seed's runtime theme switch) is the reference for the `data-mode` /
  `data-refarm-theme` toggling behavior; study it during implementation.

## 5. Verification plan (runs in `cranky_bassi`)

1. **Contract gate:** `pnpm -C packages/ds run test` — all four shipped themes pass conformance;
   incomplete theme reports correct `missing`.
2. **Scope check:** a fixture page applies `[data-refarm-theme="tractor-green"]` to a subtree and
   asserts the host `:root` is unaffected (no leak).
3. **Consumer proof:** on a `vault-seed` branch, swap `.site/styles` to the `ds` contract + one
   theme; `dgk build` / site renders with no visual regression (the existing manual site test
   roteiro).
4. **Final gate:** `pnpm -C packages/ds run lint && type-check && test`.

## 6. Out of scope

- **4b** — recomposing the `dgk serve` admin UI from `homestead` primitives (separate spec).
- **4c** — `credentials/` ↔ `silo` reconciliation (separate decision).
- Growing the component library (`Button` and beyond) past tokens — a later `ds` increment.
- Publishing `@refarm.dev/ds` — gated by ADR-069 scope work and the first contract publish.

## 7. Open questions

- Are preset themes (`oceano`/...) shipped inside `@refarm.dev/ds`, or in a separate
  `@refarm.dev/ds-themes` so the core stays brand-only? (Recommend: ship in `ds` now; split later
  if the set grows.)
- Tailwind bridge: a CSS file (`tailwind-bridge.css`) or a Tailwind v4 `@theme` preset export?
  (Recommend: CSS file now; preset when a consumer needs the Tailwind plugin API.)
