# DS Token Contract (Item 4a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow `@refarm.dev/ds` into the semantic token contract (shadcn-aligned, scoped, multi-theme) with a theme-conformance suite, so `vault-seed`'s Lab can consume it.

**Architecture:** A token *contract* (`REQUIRED_TOKENS` + `runDsThemeConformance`) + scoped CSS (`@layer refarm.tokens` under `[data-refarm-theme]`, never raw `:root`) + a reference theme (`tractor-green`) and presets (`oceano`/`terracota`/`verde-jardim`) lifted from `vault-seed`. Headless component classes (`.ds-*`) for item 4b. Mirrors the contract idiom of `storage-contract-v1`.

**Tech Stack:** TypeScript (ESM), pnpm, vitest, CSS `@layer`. The `@refarm.dev/ds` package already exists (`src/{tokens.css,styles.css,index.ts,Button.stories.ts,contrast.test.ts}`); this plan extends it.

**Spec:** `specs/features/2026-06-25-ds-token-contract.md`

## Global Constraints

- **Module:** ESM; `.js` import specifiers in TS. **Test:** `pnpm -C packages/ds run test`.
- **Naming:** semantic shadcn names, **unprefixed** (`--background`, not `--refarm-background`).
- **Scoping:** contract variables only under `[data-refarm-theme]` inside `@layer refarm.tokens` / `@layer refarm.theme` — **never bare `:root`**.
- **Capability string:** exactly `"ds-tokens:v1"`. **Conformance total:** `REQUIRED_TOKENS.length` (30).
- **Reference theme:** `tractor-green`. Dark via `[data-refarm-theme][data-mode="dark"]`.
- The old `--refarm-*` `tokens.css` is replaced by the scoped semantic `tokens.css` (keep `styles.css` and the Button untouched unless a token rename breaks them — fix references if so).

---

### Task 1: Token contract + conformance (TDD)

**Files:**
- Create: `packages/ds/src/contract.ts`
- Create: `packages/ds/src/conformance.ts`
- Create: `packages/ds/src/conformance.test.ts`

**Interfaces:**
- Produces: `DS_TOKEN_CAPABILITY`, `REQUIRED_TOKENS`, `DsToken`, `DsTheme`, `DsThemeConformanceResult` (contract.ts); `runDsThemeConformance(theme: Partial<DsTheme>): DsThemeConformanceResult` (conformance.ts).

- [ ] **Step 1: Write the failing test** — `src/conformance.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { REQUIRED_TOKENS, type DsTheme } from "./contract.js";
import { runDsThemeConformance } from "./conformance.js";

function completeTheme(): DsTheme {
  return Object.fromEntries(REQUIRED_TOKENS.map((t) => [t, "x"])) as DsTheme;
}

describe("ds-tokens:v1 conformance", () => {
  it("passes for a theme defining every required token", () => {
    const r = runDsThemeConformance(completeTheme());
    expect(r.pass).toBe(true);
    expect(r.total).toBe(REQUIRED_TOKENS.length);
    expect(r.failed).toBe(0);
    expect(r.missing).toEqual([]);
  });

  it("reports the exact missing tokens", () => {
    const theme = completeTheme();
    delete (theme as Record<string, string>).primary;
    delete (theme as Record<string, string>)["radius-md"];
    const r = runDsThemeConformance(theme);
    expect(r.pass).toBe(false);
    expect(r.missing).toContain("primary");
    expect(r.missing).toContain("radius-md");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/ds run test`
Expected: FAIL — cannot resolve `./contract.js` / `./conformance.js`.

- [ ] **Step 3: Create `src/contract.ts`** (verbatim from spec §1)

```ts
export const DS_TOKEN_CAPABILITY = "ds-tokens:v1" as const;

/** Required semantic variables every conforming theme MUST define (without the leading `--`). */
export const REQUIRED_TOKENS = [
  "background", "foreground",
  "card", "card-foreground",
  "popover", "popover-foreground",
  "muted", "muted-foreground",
  "primary", "primary-foreground",
  "secondary", "secondary-foreground",
  "accent", "accent-foreground",
  "border", "input", "ring",
  "error", "warning", "success", "info",
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

- [ ] **Step 4: Create `src/conformance.ts`** (verbatim from spec §3)

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

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -C packages/ds run test`
Expected: PASS — both conformance tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/ds/src/contract.ts packages/ds/src/conformance.ts packages/ds/src/conformance.test.ts
git commit -m "feat(ds): ds-tokens:v1 contract and theme conformance"
```

---

### Task 2: Scoped `tokens.css` + `tractor-green` reference theme + CSS conformance (TDD)

**Files:**
- Create: `packages/ds/src/themes/tractor-green.css`
- Modify: `packages/ds/src/tokens.css` (replace `--refarm-*` block with scoped semantic declarations)
- Create: `packages/ds/src/theme-css.test.ts`

**Interfaces:**
- Consumes: `REQUIRED_TOKENS`, `runDsThemeConformance`.
- Produces: a CSS-parse test helper `tokensInThemeCss(path): Partial<DsTheme>` (local to the test).

- [ ] **Step 1: Write the failing test** — `src/theme-css.test.ts`

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REQUIRED_TOKENS, type DsTheme } from "./contract.js";
import { runDsThemeConformance } from "./conformance.js";

function tokensInThemeCss(relPath: string): Partial<DsTheme> {
  const css = readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), "utf8");
  const out: Record<string, string> = {};
  for (const t of REQUIRED_TOKENS) {
    const m = new RegExp(`--${t}\\s*:\\s*([^;]+);`).exec(css);
    if (m) out[t] = m[1].trim();
  }
  return out as Partial<DsTheme>;
}

describe("shipped theme CSS conformance", () => {
  it("tractor-green defines every required token", () => {
    const r = runDsThemeConformance(tokensInThemeCss("./themes/tractor-green.css"));
    expect(r.missing).toEqual([]);
    expect(r.pass).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/ds run test`
Expected: FAIL — `themes/tractor-green.css` does not exist.

- [ ] **Step 3: Create `src/themes/tractor-green.css`** (reference theme — values from the current `--refarm-*` palette, re-expressed semantically)

```css
@layer refarm.theme {
  [data-refarm-theme="tractor-green"] {
    --background: #0d1117;
    --foreground: #c9d1d9;
    --card: #161b22;
    --card-foreground: #c9d1d9;
    --popover: #21262d;
    --popover-foreground: #c9d1d9;
    --muted: #21262d;
    --muted-foreground: #8b949e;
    --primary: #238636;
    --primary-foreground: #ffffff;
    --secondary: #2ea043;
    --secondary-foreground: #ffffff;
    --accent: #2ea043;
    --accent-foreground: #ffffff;
    --border: #30363d;
    --input: #30363d;
    --ring: #58a6ff;
    --error: #f85149;
    --warning: #d29922;
    --success: #3fb950;
    --info: #58a6ff;
    --radius-sm: 4px;
    --radius-md: 8px;
    --radius-lg: 12px;
    --shadow-sm: 0 1px 0 rgba(1, 4, 9, 0.04);
    --shadow-md: 0 4px 8px rgba(1, 4, 9, 0.3);
    --shadow-lg: 0 24px 80px rgba(1, 4, 9, 0.28);
    --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
    --font-mono: "Fira Code", "Cascadia Code", "Source Code Pro", monospace;
  }
}
```

- [ ] **Step 4: Replace `src/tokens.css`** with the scoped entry layer (drop the old `--refarm-*` block)

```css
/* @refarm.dev/ds — token contract entry. Scoped, never bare :root.
 * Import a theme file (themes/<name>.css) alongside this. */
@layer refarm.tokens, refarm.theme;

@layer refarm.tokens {
  /* The contract surface is declared by the active theme under [data-refarm-theme].
   * This file establishes the cascade layer order so themes win predictably and
   * never leak onto a host :root. */
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -C packages/ds run test`
Expected: PASS — `tractor-green` defines all 30 tokens.

- [ ] **Step 6: Commit**

```bash
git add packages/ds/src/tokens.css packages/ds/src/themes/tractor-green.css packages/ds/src/theme-css.test.ts
git commit -m "feat(ds): scoped token layer and tractor-green reference theme"
```

---

### Task 3: Preset themes (`oceano`, `terracota`, `verde-jardim`)

**Files:**
- Create: `packages/ds/src/themes/{oceano,terracota,verde-jardim}.css`
- Modify: `packages/ds/src/theme-css.test.ts` (assert all four themes)

**Interfaces:** consumes the Task 2 test helper.

- [ ] **Step 1: Extend the failing test** — add to `theme-css.test.ts`:

```ts
it.each(["oceano", "terracota", "verde-jardim"])("%s defines every required token", (name) => {
  const r = runDsThemeConformance(tokensInThemeCss(`./themes/${name}.css`));
  expect(r.missing).toEqual([]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/ds run test`
Expected: FAIL — the three preset files do not exist.

- [ ] **Step 3: Author the three preset CSS files**

Transcribe values from `vault-seed`'s palettes into the **same 30-token shape as `tractor-green.css`**, under `[data-refarm-theme="<name>"]`:
- `verde-jardim` — from `vault-seed/.site/styles/marimo-vault.css` (the Lab's shadcn values: bg `#111310`, fg `#f7f5f0`, primary `#95d5b2`, primary-foreground `#111310`, …). This is the dogfood theme the Lab will re-consume.
- `oceano`, `terracota` — from `vault-seed/.site/styles/themes/{oceano,terracota}.css`, mapping the Starlight palette to the semantic set (accent→`--primary`/`--accent`, gray scale→`--muted`/`--border`/`--foreground`, black/white→`--background`/`--foreground`). Fill **every** `REQUIRED_TOKEN`; reuse the `tractor-green` primitives (radius/shadow/font) unless a palette overrides them.

Each file follows the exact structure of `tractor-green.css` (all 30 vars). The conformance test in Step 2 is the gate that they are complete.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -C packages/ds run test`
Expected: PASS — all four themes define every token.

- [ ] **Step 5: Commit**

```bash
git add packages/ds/src/themes
git commit -m "feat(ds): oceano, terracota, verde-jardim preset themes (from vault-seed)"
```

---

### Task 4: Scope-discipline test + component classes

**Files:**
- Create: `packages/ds/src/scope.test.ts`
- Create: `packages/ds/src/components.css`

**Interfaces:** produces `.ds-card`, `.ds-btn`, `.ds-field`, `.ds-table`, `.ds-section`, `.ds-feedback` (consumed by item 4b).

- [ ] **Step 1: Write the failing scope test** — `src/scope.test.ts`

```ts
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function read(rel: string) {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("token scope discipline", () => {
  it("no theme assigns contract tokens on a bare :root", () => {
    const dir = fileURLToPath(new URL("./themes/", import.meta.url));
    for (const f of readdirSync(dir)) {
      const css = read(`./themes/${f}`);
      // a bare :root selector block must not appear in theme files
      expect(/:root\s*\{/.test(css)).toBe(false);
      expect(css).toContain("[data-refarm-theme=");
    }
  });

  it("components.css styles only through tokens (no raw hex)", () => {
    const css = read("./components.css");
    expect(css).toContain(".ds-card");
    expect(css).toContain(".ds-btn");
    expect(/#[0-9a-fA-F]{3,8}\b/.test(css)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/ds run test`
Expected: FAIL — `components.css` does not exist.

- [ ] **Step 3: Create `src/components.css`** (headless classes over tokens, no hex)

```css
@layer refarm.components {
  .ds-section { margin-block: 1.5rem; }
  .ds-card {
    background: var(--card);
    color: var(--card-foreground);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    padding: 1rem;
  }
  .ds-btn {
    background: var(--primary);
    color: var(--primary-foreground);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.4rem 0.9rem;
    font-family: var(--font-sans);
    cursor: pointer;
  }
  .ds-btn:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .ds-field label { display: block; color: var(--muted-foreground); font-size: 0.8rem; }
  .ds-field input {
    width: 100%;
    background: var(--background);
    color: var(--foreground);
    border: 1px solid var(--input);
    border-radius: var(--radius-sm);
    padding: 0.35rem 0.6rem;
  }
  .ds-table { width: 100%; border-collapse: collapse; color: var(--foreground); }
  .ds-table th, .ds-table td { border-bottom: 1px solid var(--border); padding: 0.4rem 0.5rem; text-align: left; }
  .ds-feedback { border-radius: var(--radius-sm); padding: 0.5rem 0.75rem; }
  .ds-feedback[data-kind="error"] { color: var(--error); }
  .ds-feedback[data-kind="warning"] { color: var(--warning); }
  .ds-feedback[data-kind="success"] { color: var(--success); }
  .ds-feedback[data-kind="info"] { color: var(--info); }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -C packages/ds run test`
Expected: PASS — scope + components tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/ds/src/scope.test.ts packages/ds/src/components.css
git commit -m "feat(ds): scope-discipline test and headless component classes"
```

---

### Task 5: Tailwind bridge, exports, acceptance wiring, consumer-proof packet

**Files:**
- Create: `packages/ds/src/tailwind-bridge.css`
- Modify: `packages/ds/src/index.ts`
- Modify: `packages/ds/package.json` (export the CSS entry points)
- Modify: `scripts/ci/test-capabilities.mjs`, `scripts/ci/gate-smoke-contracts.mjs`
- Create: `.changeset/ds-token-contract.md`

- [ ] **Step 1: Create `src/tailwind-bridge.css`** (Tailwind v4 `--color-*` aliases → semantic vars)

```css
@layer refarm.tokens {
  [data-refarm-theme] {
    --color-background: var(--background);
    --color-foreground: var(--foreground);
    --color-card: var(--card);
    --color-primary: var(--primary);
    --color-secondary: var(--secondary);
    --color-accent: var(--accent);
    --color-muted: var(--muted);
    --color-border: var(--border);
  }
}
```

- [ ] **Step 2: Update `src/index.ts`** to re-export the contract + conformance

```ts
export { runDsThemeConformance } from "./conformance.js";
export * from "./contract.js";
// CSS entry points (consumers import directly):
//   @refarm.dev/ds/tokens.css, /components.css, /tailwind-bridge.css, /themes/<name>.css
```

- [ ] **Step 3: Add CSS exports to `package.json`** `exports` map

```jsonc
"./tokens.css": "./src/tokens.css",
"./components.css": "./src/components.css",
"./tailwind-bridge.css": "./src/tailwind-bridge.css",
"./themes/*": "./src/themes/*"
```

- [ ] **Step 4: Register the conformance test in both gate lists**

`scripts/ci/test-capabilities.mjs` STEPS — add `["packages/ds", "test"]` (ds uses `test`, not `test:unit`; confirm the script name in `packages/ds/package.json` and match it).
`scripts/ci/gate-smoke-contracts.mjs` STEPS — add `["packages/ds", "build"]` and `["packages/ds", "test"]`.

- [ ] **Step 5: Add the changeset** — `.changeset/ds-token-contract.md`

```markdown
---
"@refarm.dev/ds": minor
---

ds-tokens:v1 semantic token contract: scoped themes (tractor-green + oceano/terracota/verde-jardim), conformance suite, and headless component classes.
```

- [ ] **Step 6: Run the gates + final lint/type-check**

Run: `pnpm -C packages/ds run lint && pnpm -C packages/ds run type-check && pnpm -C packages/ds run test && pnpm run validate-packages && pnpm run gate:smoke:contracts`
Expected: PASS — all green; `ds` appears in the contracts-smoke output.

- [ ] **Step 7: Record the consumer-proof packet** (do not block this plan on it)

Per `docs/DEV_CROSS_REPO_CONSUMPTION.md`: `pnpm -C packages/ds pack` → install the tarball in a `vault-seed` branch → follow `vault-seed docs/convergencia-ds-lab.md` (Lab adopts `tokens.css` + `verde-jardim`). The consumer proof lives on the `vault-seed` side; this packet just records the command + the expected no-regression check.

- [ ] **Step 8: Commit**

```bash
git add packages/ds/src/tailwind-bridge.css packages/ds/src/index.ts packages/ds/package.json scripts/ci/test-capabilities.mjs scripts/ci/gate-smoke-contracts.mjs .changeset/ds-token-contract.md
git commit -m "feat(ds): tailwind bridge, exports, and capability-gate registration"
```

---

## Self-Review

**Spec coverage:** contract (§1) → Task 1; scoped tokens.css + reference theme (§2) → Task 2; presets (§2.5) → Task 3; conformance (§3) → Tasks 1–3; scope discipline (decision 3) → Task 4; component classes (for 4b) → Task 4; tailwind bridge + presets-in-ds (§7) → Tasks 3/5; acceptance wiring (§8) → Task 5; consumer proof (§4/§5) → Task 5 Step 7. ✓

**Placeholder scan:** Task 3 Step 3 transcribes values from named existing files using the `tractor-green.css` template — concrete instruction, not "TBD"; the conformance test is the gate. No other placeholders.

**Type consistency:** `runDsThemeConformance`, `REQUIRED_TOKENS`, `DsTheme` consistent across contract.ts, conformance.ts, and all three test files. CSS var names match `REQUIRED_TOKENS` (the CSS-parse test enforces this).
