# Spec: Homestead Build-Free Surface Tier + dgk admin (Roadmap Item 4b)

**Status:** Superseded by ADR-072 on 2026-06-29
**Authors:** Arthur Silva
**Date:** 2026-06-25
**Related:** `docs/CONVERGENCE_ROADMAP.md` (item 4), `specs/features/2026-06-25-ds-token-contract.md` (4a — dependency), `docs/APPS_REFARM_PROMOTION_LEDGER.md`

> Superseded outcome: the build-free HTML helper surface is owned by `@refarm.dev/ds/html`.
> `@refarm.dev/homestead/ssr` and `@refarm.dev/homestead-ssr` were removed pre-publication so
> Homestead stays focused on SDK/shell/runtime integration.

---

## Context & Motivation

Item 4b is "the admin UI composed from `homestead` blocks." The cola (cross-repo read) found a
weight mismatch:

- `vault-seed`'s admin UI (`packages/cli/src/commands/serve.js`) is a ~200-line page served by
  `node:http` — **zero frontend deps, no bundler**: an inline `ADMIN_HTML` string + `<style>` with
  its own palette (`#1a1a2e`/`#00d4aa`, a third palette distinct from `ds` and the site themes) +
  vanilla `fetch` client.
- `@refarm.dev/homestead/sdk` is a **bundled, browser-runtime studio-host** (Shell, surface-slots,
  streaming, plugin-handle, A11yGuard, i18n) — for mounting plugin surfaces. Forcing a 200-line
  admin onto it is over-engineering: the admin mounts no plugins and streams nothing.
- But `homestead` already has **string render helpers** (`renderStreamPanelHtml`,
  `renderStreamStatusbarHtml`) — an SSR/string path that fits `serve.js` with no bundler.

So `homestead` has two audiences and only the heavy one is packaged. Decision (owner, 2026-06-25):
**expose `homestead`'s build-free string/SSR tier** — render helpers + `ds` tokens + baked-in a11y
— as the consumable for server-rendered surfaces. `serve.js` consumes it and stays `node:http`-pure.

## Decisions

1. **New build-free tier as a subpath export:** `@refarm.dev/homestead/ssr` — pure functions that
   return HTML strings + the page shell. **No browser runtime, no custom elements, no bundler.**
   Importable in a plain node script. Kept separate from `@refarm.dev/homestead/sdk` (the runtime).
2. **Component classes live in `ds`, render helpers live in `homestead/ssr`.** `ds` owns tokens
   (4a) **and** the headless component CSS classes built on those tokens (the current
   `.refarm-button`/`.refarm-card` reborn as `.ds-*` over the contract). `homestead/ssr` owns the
   functions that emit markup using those classes plus page composition.
3. **a11y baked into the string output** — the helpers emit the labels, roles, and focus affordances
   `A11yGuard` enforces at runtime, so build-free surfaces are not a11y-worse than bundled ones.
4. **Isomorphic helpers** — the same functions run server-side (in `serve.js`'s response) and
   client-side (in the `fetch`-driven re-render), replacing the inline `innerHTML` templates.
5. **Palette via `ds`, not inline** — `serve.js`'s `#1a1a2e/#00d4aa` is dropped for a `ds` theme.

## 1. Tier interface (`packages/homestead/src/ssr/index.ts`)

```ts
export interface ShellOptions {
  title: string;
  lang?: string;            // default "en"
  theme?: string;           // ds theme name, default "tractor-green"
  bodyHtml: string;
}

/** Full document: doctype + head linking ds tokens + <body data-refarm-theme=…>. */
export function shellHtml(opts: ShellOptions): string;

export function sectionHtml(title: string, innerHtml: string): string;
export function gridHtml(cardsHtml: string[]): string;
export function cardHtml(opts: {
  title: string;
  rows: string[];
  active?: boolean;
  actionsHtml?: string;
}): string;
export function tableHtml(opts: { headers: string[]; rows: string[][] }): string;
export function fieldHtml(opts: {
  label: string;
  name: string;
  value?: string;
  type?: string;            // default "text"
}): string;
export function buttonHtml(opts: {
  label: string;
  variant?: "primary" | "danger" | "ghost";
  attrs?: Record<string, string>;
}): string;
export function feedbackHtml(opts: {
  kind: "error" | "warning" | "success" | "info";
  message: string;
}): string;
export function footerHtml(text: string): string;

/** Promoted from serve.js's local esc(). */
export function escapeHtml(value: unknown): string;
```

Every helper emits `ds` component classes (`ds-card`, `ds-btn`, `ds-field`, `ds-table`, …) styled
by the `ds` token contract — no inline colors. `escapeHtml` is applied to all interpolated user
content.

## 2. Package wiring

**refarm `homestead`:**
- `packages/homestead/src/ssr/{index,render,shell}.ts` + `ssr/index.test.ts`.
- `package.json` `exports` adds `"./ssr": { "import": "./dist/ssr/index.js", "types": "./dist/ssr/index.d.ts" }`.
- `ssr` depends on `@refarm.dev/ds` (classnames/tokens) only — **must not** import `./sdk` (the
  runtime). A test asserts this isolation.

**refarm `ds`** (extends 4a):
- Add `src/components.css` — headless component classes (`.ds-card`, `.ds-btn`, `.ds-field`,
  `.ds-table`, `.ds-section`, `.ds-feedback`) built entirely on the token contract. This is the
  `.refarm-button`/`.refarm-card` utility layer, reborn on semantic tokens.

**vault-seed `serve.js`:**
- `import { shellHtml, sectionHtml, gridHtml, cardHtml, tableHtml, fieldHtml, buttonHtml, feedbackHtml, footerHtml, escapeHtml } from "@refarm.dev/homestead/ssr";`
- Rebuild `ADMIN_HTML` and the client re-render from these helpers; drop the inline `<style>`
  palette and local `esc()`. Keep `node:http`, the `/api/*` routes, and the `fetch` client intact.

## 3. Verification plan

1. **Tier unit tests:** each helper returns the expected HTML, escapes interpolated content, and
   uses `ds` classes; run under plain `node` (no DOM) to prove build-free.
2. **Isolation check:** importing `@refarm.dev/homestead/ssr` pulls no browser-runtime/`./sdk`
   modules (assert via import graph / a focused test).
3. **a11y check:** rendered output passes the same label/role rules `A11yGuard` enforces (reuse its
   assertions against the string output).
4. **Consumer proof:** rebuild `vault-seed`'s `serve.js` on the tier; `dgk serve` renders with no
   functional regression — the existing `docs/roteiro-teste-admin.md` manual script passes; palette
   now comes from a `ds` theme. Consumer-side adoption plan:
   `vault-seed docs/convergencia-homestead-admin.md`.
5. **Final gate:** `pnpm -C packages/homestead run lint && type-check && test`.

## 4. Out of scope

- The bundled `studio-host` SDK (`homestead/sdk`) — unchanged.
- `serve.js`'s server logic and `/api/*` routes — unchanged.
- Growing `ds` components beyond what the admin needs.
- **4c** — `credentials/` ↔ `silo` reconciliation (separate decision).

## 5. Decisions (resolved 2026-06-25 — no mid-build pauses)

- **Subpath is `/ssr`** (`@refarm.dev/homestead/ssr`).
- **Plain semantic HTML now** — the bundled `studio-host` tier is a separate consumer; do not
  pre-shape for it.
- **`apps/refarm`'s headless/string outputs become the second consumer** (`headless.ts`,
  `status-output.ts`, `doctor-output.ts`) — not built here, tracked as the item-4 follow-up that
  validates the tier beyond `vault-seed`.

## 6. Integration

- **Package acceptance:** `homestead` already exists — apply `docs/PACKAGE_ACCEPTANCE_CHECKLIST.md`
  #2/#3 (register the `ssr` test under `test-capabilities.mjs` / `gate-smoke-contracts.mjs`) and #6
  (changeset) when implementing.
- **Consumer proof consumption:** `vault-seed`'s `serve.js` rebuild (§3) consumes the built tier via
  the local-tarball path in `docs/DEV_CROSS_REPO_CONSUMPTION.md`.
