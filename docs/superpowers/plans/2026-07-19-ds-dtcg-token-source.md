# DS DTCG Token Source (fatia 2) — Implementation Plan

> **Status: DRAFT for approval.** Sequenced after fatia 1 (role="log" + Intl.RelativeTimeFormat, landed).
> Feeds the verdict in `docs/research/2026-07-18-reinventing-the-wheel-ds-i18n-a11y.md` (§ "Design tokens").
> Extends the `ds-tokens:v1` contract (`specs/features/2026-06-25-ds-token-contract.md`).

**Goal:** Invert the token source of truth in `@refarm.dev/ds`. Today the built-in themes are authored
as `.css` and the surface-neutral `DsTheme` is *reverse-extracted from CSS by regex* — the inverse of
refarm's own "declare once → project to many surfaces" invariant. After this slice the source is a
**DTCG (W3C Design Tokens) JSON** per theme, from which we deterministically **emit** the exact
`themes/*.css` shipped today **and** a static `DsTheme` object every non-CSS surface (TUI, agent) can
consume — closing the CSS-coupling gap the verdict flagged, at the root, without changing a single byte
that web consumers import.

---

## The one decision to confirm before we start

**Adopt DTCG as the token _source format_; emit via a thin in-repo deterministic transform; DEFER Style
Dictionary to the first native-platform target.**

Rationale (grounded in the real code, not the generic verdict): refarm's shipped CSS is bespoke —
`@layer ds.theme`, a **white-label dual selector** `:where([data-ds-theme="X"], [data-refarm-theme="X"])`,
and **modes** (`verde-jardim` ships light/dark override blocks). Style Dictionary's stock CSS formats do
not produce that structure, so adopting SD would still require a fully custom format that reproduces our
selector/layer/mode conventions — at which point SD parses JSON and calls our format function and little
else. SD's real dividend is its **library of native formats** (iOS/Android/Flutter) + reference
resolution; neither applies until refarm targets a native platform, and our actual non-web target
(TUI/ANSI, `projectThemeToTui`) is a bespoke transform SD doesn't provide either.

So: **DTCG is the commitment** (vendor-neutral, stable 2025.10, Figma/Tokens Studio interop, and the
thing that lets SD drop in later without re-authoring tokens). The emit engine is a ~60-line pure
in-repo transform now. When a native target appears, swap the emit engine for Style Dictionary — the
DTCG source is unchanged. This is a refinement of the verdict's "DTCG + Style Dictionary", earned by
measuring the code. **Confirm this, or say if you want SD forced in as the engine now.**

---

## Architecture

**Source (new, the truth):** `packages/ds/src/tokens/`
- `tractor-green.tokens.json`, `oceano.tokens.json`, `terracota.tokens.json`, `verde-jardim.tokens.json`
  — one DTCG file per theme (base). Each token: `{ "$type": "color|dimension|…", "$value": "<css>" }`.
  Colors → `$type:"color"`, radii → `$type:"dimension"`; shadow/fontFamily carry the raw CSS string as
  `$value` for byte-fidelity in v1 (structural DTCG modeling deferred — a note in the file).
- `verde-jardim.light.tokens.json` — the light-mode **override subset** (only the tokens the light block
  overrides, + the `color-scheme` marker intent).
- `themes.manifest.json` — drives the emitter: `[{ id, base, modes?: { light?, dark? } }]`.

**Emitted (derived, byte-faithful to today):**
- `src/themes/<name>.css` — generated; identical to the committed file today (drift-guarded).
- `src/builtin-themes.generated.ts` — `export const BUILTIN_THEMES: Record<string, DsTheme>` (base,
  flattened) — the static, browser-safe, typed source of built-ins for the registry / TUI / agent.

**Pure modules:**
- `src/tokens-source.ts` — DTCG types + `dtcgToDsTheme(file): Partial<DsTheme>` (drop `$type`, flatten
  `$value`).
- `src/tokens-emit.ts` — `emitThemeCss(entry, files): string` and `emitBuiltinThemes(...)` — PURE
  (no I/O), so both are unit-testable and the drift guard compares strings.

**Generate + guard:**
- `scripts/generate-tokens.mjs` — reads the JSON + manifest, writes the emitted CSS + `.generated.ts`.
  Wired as `pnpm -C packages/ds run generate` and a `prebuild` hook so `build` always regenerates.
- Drift-guard tests assert `emit(source) === committed file` for every theme and the generated TS — so
  the committed generated files can never silently diverge from the DTCG source. A generated file is
  never hand-edited; edit the JSON and run `generate`.

**Conformance inversion:** `theme-css.test.ts` (regex-extract tokens from CSS → conformance) is replaced
by (a) **source conformance** — `runDsThemeConformance(dtcgToDsTheme(json))` per theme, and (b) the drift
guard. The CSS-regex round-trip retires; the JSON is the source, the CSS is derived.

---

## Global constraints

- **Byte-fidelity is the gate.** Every emitted `themes/*.css` must equal the current committed bytes
  (tabs, `@layer ds.theme`, the exact dual `:where(...)` selector, blank lines, `rgba(...)` spacing).
  The drift test is the proof; `git diff` on the CSS after 2a–2c must be empty.
- **`tokens.css` is out of scope** — it is the theme-independent *derivation* layer (`--ds-*`/`--refarm-*`
  aliases + `color-mix` semantics), not token values. Untouched.
- **Determinism:** the emitter must be pure and order-stable (iterate `REQUIRED_TOKENS` order). No
  `Date`/random. Same JSON → same bytes, always (so CI regeneration matches the commit).
- **Scope discipline preserved:** emitted CSS still never uses bare `:root`; `scope.test.ts` stays green.
- **Contract unchanged:** `REQUIRED_TOKENS` (30) and `ds-tokens:v1` are the same; this changes *where the
  values come from*, not the contract.
- Module: ESM, `.js` specifiers. Test: `pnpm -C packages/ds run test`. Validate scoped; broad gates at push.

---

## Tasks (TDD, each an atomic commit, each green)

### 2a — the machine, proven on `tractor-green`
**Files:** create `src/tokens/tractor-green.tokens.json`, `src/tokens/themes.manifest.json`,
`src/tokens-source.ts`, `src/tokens-emit.ts`, `scripts/generate-tokens.mjs`, `src/tokens-emit.test.ts`,
`src/tokens-source.test.ts`.
- [ ] Write `tokens-source.test.ts`: `dtcgToDsTheme(tractorGreenJson)` passes `runDsThemeConformance`
  (all 30, `missing: []`).
- [ ] Write `tokens-emit.test.ts` (the DRIFT GUARD): `emitThemeCss(entry, files)` **=== the current bytes
  of** `src/themes/tractor-green.css` (read the committed file).
- [ ] Author `tractor-green.tokens.json` (transcribe the 30 values from the current CSS) + manifest entry.
- [ ] Implement `tokens-source.ts` + `tokens-emit.ts` until both tests pass. Run `generate` → confirm
  `git diff src/themes/tractor-green.css` is EMPTY (byte-faithful).
- [ ] `pnpm -C packages/ds run test` green. **Commit:** `feat(ds): DTCG token source + faithful CSS emit (tractor-green)`.

### 2b — the other base themes
**Files:** create `src/tokens/{oceano,terracota}.tokens.json`; extend manifest + `tokens-emit.test.ts`.
- [ ] Extend the drift test to oceano + terracota (`it.each`).
- [ ] Author both DTCG files; `generate`; confirm empty CSS diff for both.
- [ ] Green. **Commit:** `feat(ds): DTCG source for oceano + terracota themes`.

### 2c — modes (`verde-jardim` light/dark)
**Files:** create `src/tokens/verde-jardim.tokens.json` + `verde-jardim.light.tokens.json`; extend
manifest (`modes`), emitter (base + light override block + dark marker), drift test.
- [ ] Extend the emitter to emit the base block, the `[data-mode="light"]` override (both selector
  forms) with only the override-subset tokens + `color-scheme: light`, and the `[data-mode="dark"]`
  marker — reproducing the current file exactly. Fold in the light/dark assertions from `theme-css.test.ts`.
- [ ] Author the base + light-override DTCG files; `generate`; confirm empty diff for `verde-jardim.css`.
- [ ] Green. **Commit:** `feat(ds): DTCG source with mode overrides (verde-jardim)`.

### 2d — retire CSS-regex; ship built-in DsTheme JSON; prove multi-surface
**Files:** delete `src/theme-css.test.ts`; add `src/tokens-builtin.test.ts`; generate
`src/builtin-themes.generated.ts`; export `BUILTIN_THEMES` from `index.ts`.
- [ ] Generate `builtin-themes.generated.ts` (`BUILTIN_THEMES: Record<string, DsTheme>`, base) + drift
  guard.
- [ ] `tokens-builtin.test.ts`: (a) every `BUILTIN_THEMES[id]` passes conformance; (b) the multi-surface
  dividend — `projectThemeToTui(BUILTIN_THEMES["verde-jardim"])` yields stable ANSI (built-in reaches the
  terminal from the DTCG source, no CSS regex); (c) `new ThemeRegistry().register(id, BUILTIN_THEMES[id],
  "built-in")` succeeds for all four.
- [ ] Remove `theme-css.test.ts` (its conformance is now source-based; its light/dark assertions moved to
  2c's drift test).
- [ ] Export `BUILTIN_THEMES`. Green. **Commit:** `feat(ds): built-in themes as DsTheme JSON from DTCG source (TUI/registry-ready)`.

### 2e — wire, docs, changeset
**Files:** `package.json` (scripts + maybe a `./tokens/*` export), CI gate lists, the spec + research doc,
`.changeset/`.
- [ ] `package.json`: `"generate": "node scripts/generate-tokens.mjs"`, `"prebuild": "pnpm run generate"`.
- [ ] Register the drift + builtin tests in `scripts/ci/test-capabilities.mjs` / gate lists if the ds
  entries need updating.
- [ ] Update `specs/features/2026-06-25-ds-token-contract.md` (DTCG source is now the truth; CSS is
  generated) and add a one-line "Style Dictionary deferred to native-target trigger" note to the research
  doc's §1.
- [ ] `.changeset/ds-dtcg-token-source.md` (`@refarm.dev/ds` minor).
- [ ] Scoped ds gates green; then the push gate. **Commit:** `chore(ds): wire token generation + docs + changeset`.

---

## Validation economy
Per slice: `pnpm -C packages/ds run test` (+ `lint`/`type-check` at slice end). After 2a–2c, the load-
bearing check is `git diff --stat src/themes/` = empty (byte-fidelity). `pnpm -C packages/ds run build`
once (proves `prebuild`→`generate` wiring). Broad `validate-packages` / `gate:smoke:contracts` at push,
then watch CI. Atomic commits; keep develop green + pushed.

## Self-review
- **Trap closed at the root:** JSON is source, CSS is derived — the exact inversion the verdict named.
- **Zero consumer churn:** emitted CSS is byte-identical; `./themes/*.css` exports unchanged; `tokens.css`
  untouched. The drift guard makes fidelity a test, not a hope.
- **Multi-surface dividend is concrete + tested:** built-ins reach the TUI from the DTCG source (2d),
  not by regexing CSS.
- **SD not burned:** DTCG-as-source is precisely what lets Style Dictionary drop in as the engine the day
  a native target lands — the deferral costs nothing and avoids a dep + bespoke-format work now.
- **No placeholders:** every token value is transcribed from a named existing CSS file; the drift test is
  the gate that the transcription is exact.
