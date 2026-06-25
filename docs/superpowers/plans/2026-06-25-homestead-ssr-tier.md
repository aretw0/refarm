# Homestead Build-Free SSR Tier (Item 4b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add `@refarm.dev/homestead/ssr` — a build-free string/SSR tier (pure HTML-string helpers + page shell over `ds` tokens, baked-in a11y, no runtime/bundler) so server-rendered surfaces like `dgk serve` compose from it.

**Architecture:** Pure functions returning HTML strings that emit `ds` component classes (`.ds-*` from item 4a). A subpath export `@refarm.dev/homestead/ssr` isolated from the bundled `./sdk` studio-host. Isomorphic (server + client). Mirrors the spec's helper API exactly.

**Tech Stack:** TypeScript (ESM), pnpm, vitest. `@refarm.dev/homestead` already exists (`src/sdk/`, `src/ui/`, `src/styles/`); this adds `src/ssr/`.

**Spec:** `specs/features/2026-06-25-homestead-ssr-tier.md`

## Global Constraints

- **Depends on 4a:** the `ds` component classes (`.ds-card/.ds-btn/.ds-field/.ds-table/.ds-section/.ds-feedback`) and token contract must exist (`docs/superpowers/plans/2026-06-25-ds-token-contract.md`). The helpers emit those classes.
- **Build-free:** `src/ssr/` must NOT import `../sdk` or any browser-runtime/custom-element module. A test enforces this.
- **Escaping:** every interpolated user value passes through `escapeHtml`.
- **Module:** ESM, `.js` specifiers. **Test:** `pnpm -C packages/homestead run test`.
- `ds` styling completeness for button variants (`.ds-btn[data-variant="danger"|"ghost"]`) is a small `ds` follow-up; the helper emits the markup regardless.

---

### Task 1: Leaf render helpers (TDD)

**Files:**
- Create: `packages/homestead/src/ssr/render.ts`
- Create: `packages/homestead/src/ssr/render.test.ts`

**Interfaces:**
- Produces: `escapeHtml`, `sectionHtml`, `gridHtml`, `cardHtml`, `tableHtml`, `fieldHtml`, `buttonHtml`, `feedbackHtml`, `footerHtml` (signatures per spec §1).

- [ ] **Step 1: Write the failing test** — `src/ssr/render.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  buttonHtml, cardHtml, escapeHtml, feedbackHtml, fieldHtml, footerHtml, gridHtml, sectionHtml, tableHtml,
} from "./render.js";

describe("ssr render helpers", () => {
  it("escapes html-sensitive characters", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#x27;");
    expect(escapeHtml(null)).toBe("");
  });

  it("cardHtml uses ds-card and escapes the title", () => {
    const html = cardHtml({ title: "<b>Tel</b>", rows: ["<div>r</div>"], active: true });
    expect(html).toContain('class="ds-card"');
    expect(html).toContain('data-active="1"');
    expect(html).toContain("&lt;b&gt;Tel&lt;/b&gt;");
    expect(html).toContain("<div>r</div>");
  });

  it("buttonHtml emits ds-btn + variant + escaped attrs", () => {
    const html = buttonHtml({ label: "Save", variant: "danger", attrs: { "data-svc": 'a"b' } });
    expect(html).toContain('class="ds-btn"');
    expect(html).toContain('data-variant="danger"');
    expect(html).toContain('data-svc="a&quot;b"');
    expect(html).toContain(">Save<");
  });

  it("tableHtml renders headers and rows with escaping", () => {
    const html = tableHtml({ headers: ["A"], rows: [["<x>"]] });
    expect(html).toContain('class="ds-table"');
    expect(html).toContain("<th>A</th>");
    expect(html).toContain("<td>&lt;x&gt;</td>");
  });

  it("fieldHtml binds label to input id", () => {
    const html = fieldHtml({ label: "Token", name: "tok", value: "v" });
    expect(html).toContain('for="tok"');
    expect(html).toContain('id="tok"');
    expect(html).toContain('value="v"');
  });

  it("feedbackHtml sets data-kind and role", () => {
    expect(feedbackHtml({ kind: "error", message: "no" })).toContain('data-kind="error"');
    expect(feedbackHtml({ kind: "error", message: "no" })).toContain('role="status"');
  });

  it("section/grid/footer wrap with ds classes", () => {
    expect(sectionHtml("T", "<i>")).toContain('class="ds-section"');
    expect(gridHtml(["<a>", "<b>"])).toBe('<div class="ds-grid"><a><b></div>');
    expect(footerHtml("f")).toContain('class="ds-footer"');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/homestead run test`
Expected: FAIL — `./render.js` does not exist.

- [ ] **Step 3: Create `src/ssr/render.ts`**

```ts
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export function sectionHtml(title: string, innerHtml: string): string {
  return `<section class="ds-section"><h2>${escapeHtml(title)}</h2>${innerHtml}</section>`;
}

export function gridHtml(cardsHtml: string[]): string {
  return `<div class="ds-grid">${cardsHtml.join("")}</div>`;
}

export function cardHtml(opts: {
  title: string;
  rows: string[];
  active?: boolean;
  actionsHtml?: string;
}): string {
  const active = opts.active ? ` data-active="1"` : "";
  const actions = opts.actionsHtml ? `<div class="ds-card__actions">${opts.actionsHtml}</div>` : "";
  return `<div class="ds-card"${active}><div class="ds-card__title">${escapeHtml(opts.title)}</div>${opts.rows.join("")}${actions}</div>`;
}

export function tableHtml(opts: { headers: string[]; rows: string[][] }): string {
  const head = opts.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const body = opts.rows
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
    .join("");
  return `<table class="ds-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function fieldHtml(opts: { label: string; name: string; value?: string; type?: string }): string {
  const name = escapeHtml(opts.name);
  const type = escapeHtml(opts.type ?? "text");
  const value = opts.value === undefined ? "" : ` value="${escapeHtml(opts.value)}"`;
  return `<div class="ds-field"><label for="${name}">${escapeHtml(opts.label)}</label><input id="${name}" name="${name}" type="${type}"${value}></div>`;
}

export function buttonHtml(opts: {
  label: string;
  variant?: "primary" | "danger" | "ghost";
  attrs?: Record<string, string>;
}): string {
  const variant = opts.variant ?? "primary";
  const attrs = Object.entries(opts.attrs ?? {})
    .map(([k, v]) => ` ${escapeHtml(k)}="${escapeHtml(v)}"`)
    .join("");
  return `<button class="ds-btn" data-variant="${variant}"${attrs}>${escapeHtml(opts.label)}</button>`;
}

export function feedbackHtml(opts: {
  kind: "error" | "warning" | "success" | "info";
  message: string;
}): string {
  return `<div class="ds-feedback" data-kind="${opts.kind}" role="status">${escapeHtml(opts.message)}</div>`;
}

export function footerHtml(text: string): string {
  return `<footer class="ds-footer">${escapeHtml(text)}</footer>`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -C packages/homestead run test`
Expected: PASS — all render-helper tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/homestead/src/ssr/render.ts packages/homestead/src/ssr/render.test.ts
git commit -m "feat(homestead): ssr leaf render helpers (build-free, ds-classed)"
```

---

### Task 2: Page shell + tier index (TDD)

**Files:**
- Create: `packages/homestead/src/ssr/shell.ts`
- Create: `packages/homestead/src/ssr/index.ts`
- Create: `packages/homestead/src/ssr/shell.test.ts`

**Interfaces:**
- Produces: `ShellOptions`, `shellHtml(opts)` (shell.ts); `index.ts` re-exports render + shell.

- [ ] **Step 1: Write the failing test** — `src/ssr/shell.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { shellHtml } from "./index.js";

describe("shellHtml", () => {
  it("emits a scoped document linking ds css under assetBase", () => {
    const html = shellHtml({ title: "dgk admin", theme: "verde-jardim", assetBase: "/_ds", bodyHtml: "<main>x</main>" });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('<body data-refarm-theme="verde-jardim">');
    expect(html).toContain('href="/_ds/tokens.css"');
    expect(html).toContain('href="/_ds/themes/verde-jardim.css"');
    expect(html).toContain('href="/_ds/components.css"');
    expect(html).toContain("<title>dgk admin</title>");
    expect(html).toContain("<main>x</main>");
  });

  it("defaults lang=en, theme=tractor-green, assetBase=/_ds", () => {
    const html = shellHtml({ title: "t", bodyHtml: "" });
    expect(html).toContain('lang="en"');
    expect(html).toContain('data-refarm-theme="tractor-green"');
    expect(html).toContain('href="/_ds/themes/tractor-green.css"');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/homestead run test`
Expected: FAIL — `./shell.js` / `./index.js` not present.

- [ ] **Step 3: Create `src/ssr/shell.ts`**

```ts
import { escapeHtml } from "./render.js";

export interface ShellOptions {
  title: string;
  lang?: string;        // default "en"
  theme?: string;       // ds theme name, default "tractor-green"
  assetBase?: string;   // where ds css is served, default "/_ds"
  bodyHtml: string;
}

export function shellHtml(opts: ShellOptions): string {
  const lang = escapeHtml(opts.lang ?? "en");
  const theme = escapeHtml(opts.theme ?? "tractor-green");
  const base = escapeHtml(opts.assetBase ?? "/_ds");
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<link rel="stylesheet" href="${base}/tokens.css">
<link rel="stylesheet" href="${base}/themes/${theme}.css">
<link rel="stylesheet" href="${base}/components.css">
</head>
<body data-refarm-theme="${theme}">
${opts.bodyHtml}
</body>
</html>`;
}
```

- [ ] **Step 4: Create `src/ssr/index.ts`**

```ts
export * from "./render.js";
export { shellHtml, type ShellOptions } from "./shell.js";
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm -C packages/homestead run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/homestead/src/ssr/shell.ts packages/homestead/src/ssr/index.ts packages/homestead/src/ssr/shell.test.ts
git commit -m "feat(homestead): ssr page shell + tier index"
```

---

### Task 3: Build-free isolation test (no `./sdk`)

**Files:**
- Create: `packages/homestead/src/ssr/isolation.test.ts`

- [ ] **Step 1: Write the test** — asserts no `ssr/*` source imports the runtime SDK

```ts
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("ssr tier isolation", () => {
  it("no ssr source imports ../sdk or browser-runtime modules", () => {
    const dir = fileURLToPath(new URL("./", import.meta.url));
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
      const src = readFileSync(`${dir}${f}`, "utf8");
      expect(src.includes("../sdk"), `${f} must not import ../sdk`).toBe(false);
      expect(/from\s+["'][^"']*custom-element/.test(src), `${f} must not import custom-element`).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `pnpm -C packages/homestead run test`
Expected: PASS — render.ts/shell.ts/index.ts import nothing from `../sdk`.

- [ ] **Step 3: Commit**

```bash
git add packages/homestead/src/ssr/isolation.test.ts
git commit -m "test(homestead): enforce ssr build-free isolation from sdk"
```

---

### Task 4: Subpath export + acceptance wiring

**Files:**
- Modify: `packages/homestead/package.json` (add `./ssr` export)
- Modify: `scripts/ci/test-capabilities.mjs`, `scripts/ci/gate-smoke-contracts.mjs`
- Create: `.changeset/homestead-ssr-tier.md`

- [ ] **Step 1: Add the subpath export** to `packages/homestead/package.json` `exports`

```jsonc
"./ssr": {
  "import": "./dist/ssr/index.js",
  "types": "./dist/ssr/index.d.ts"
}
```

- [ ] **Step 2: Build + verify the subpath resolves**

Run: `pnpm -C packages/homestead run build`
Expected: PASS — `dist/ssr/index.js` + `.d.ts` produced.

- [ ] **Step 3: Register in both gate lists** (per `docs/PACKAGE_ACCEPTANCE_CHECKLIST.md`)

`scripts/ci/test-capabilities.mjs` STEPS — add `["packages/homestead", "test"]` (confirm the script name in `packages/homestead/package.json`; match it).
`scripts/ci/gate-smoke-contracts.mjs` STEPS — add `["packages/homestead", "build"]` and `["packages/homestead", "test"]` (skip any already present).

- [ ] **Step 4: Add the changeset** — `.changeset/homestead-ssr-tier.md`

```markdown
---
"@refarm.dev/homestead": minor
---

Add the build-free `@refarm.dev/homestead/ssr` tier: string render helpers + page shell over ds tokens, isolated from the bundled studio-host.
```

- [ ] **Step 5: Run the gates + final lint/type-check**

Run: `pnpm -C packages/homestead run lint && pnpm -C packages/homestead run type-check && pnpm -C packages/homestead run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/homestead/package.json scripts/ci/test-capabilities.mjs scripts/ci/gate-smoke-contracts.mjs .changeset/homestead-ssr-tier.md
git commit -m "feat(homestead): export ./ssr subpath and register acceptance gates"
```

---

### Task 5: Consumer-proof packet (vault-seed `serve.js`)

**Files:** none in `refarm` (the consumer change lives in `vault-seed`).

- [ ] **Step 1: Pack the tier**

Run: `pnpm -C packages/homestead pack`
Expected: a `.tgz` containing `dist/ssr/`.

- [ ] **Step 2: Record the consumer-proof steps** (executed on the `vault-seed` side)

Per `vault-seed docs/convergencia-homestead-admin.md` + `docs/DEV_CROSS_REPO_CONSUMPTION.md`: install the tarball in a `vault-seed` branch; rebuild `serve.js`'s `ADMIN_HTML` and client re-render from the helpers; serve the `ds` CSS under `/_ds`; drop the inline palette + local `esc()`. **Gate:** `dgk serve` renders with no functional regression — `vault-seed docs/roteiro-teste-admin.md` passes; `serve.js` stays `node:http`-pure (no bundler).

- [ ] **Step 3: Commit** (note only; no refarm files)

```bash
git commit --allow-empty -m "docs(homestead): record vault-seed serve.js consumer-proof packet for ssr tier"
```

---

## Self-Review

**Spec coverage:** helper API (§1) → Tasks 1–2; component classes live in ds (§ decision 2) → 4a dependency, noted; a11y baked (§ decision 3) → `feedbackHtml role`, `fieldHtml label/for` in Task 1; isomorphic (§ decision 4) → pure functions, usable client+server; palette via ds (§ decision 5) → `shellHtml` links ds theme; subpath `/ssr` (§5) → Task 4; isolation (§3.2) → Task 3; acceptance (§6) → Task 4; consumer proof (§3.4) → Task 5. ✓

**Placeholder scan:** none; Task 4 Step 3 says "confirm the script name and match it" (a real check, not a placeholder).

**Type consistency:** `escapeHtml`, `shellHtml`, `ShellOptions`, and the helper signatures match spec §1 across render.ts, shell.ts, index.ts, and the three test files. `.ds-*` class names match the ds component classes authored in the 4a plan (Task 4).
