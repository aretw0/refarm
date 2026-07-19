# @refarm.dev/ds

The Design System (DS) is the source of truth for visual tokens, styles, and
headless UI primitives shared by host and downstream ecosystem apps.

## Features

- **Semantic Tokens**: Managed via CSS variables for color, typography, and spacing.
- **Headless-First**: Focus on accessibility and behavior contracts rather than prescribed visuals.
- **Storybook Included**: Integrated development environment for component testing.

## CSS primitives

Import the scoped token contract and one theme before using DS primitives:

```css
@import "@refarm.dev/ds/tokens.css";
@import "@refarm.dev/ds/themes/tractor-green.css";
@import "@refarm.dev/ds/components.css";
```

Apply the theme on the consuming shell:

```html
<body data-ds-theme="tractor-green">
```

The previous product-specific theme attribute remains an alias:

```html
<body data-refarm-theme="tractor-green">
```

Available themes are `tractor-green`, `oceano`, `terracota`, and `verde-jardim`.
`verde-jardim` also ships a Lab-proven light override; set `data-mode="light"`
on the themed element or an ancestor to use it. The unqualified preset remains
dark for backward compatibility.
`tokens.css` never writes contract variables to bare `:root`; `--ds-*` aliases
are scoped under `[data-ds-theme]` and `[data-refarm-theme]`. Legacy
`--refarm-*` aliases are still emitted for existing host app surfaces.

Import `@refarm.dev/ds/styles/styles.css` once in a host shell to expose shared,
framework-agnostic primitives:

- layout: `.ds-grid`, `.ds-stack`, `.ds-cluster`, `.ds-split-grid`, `.ds-scroll-region`, `.ds-scroll-region-y`, `.ds-scroll-region-x`;
- surfaces: `.ds-surface`, `.ds-surface-tinted`, `.ds-panel`, `.ds-surface-card`, `.ds-card-roomy`;
- actions: `.ds-btn`, `.ds-btn-primary`, `.ds-btn-pill`;
- data display: `.ds-pill`, `.ds-badge`, `.ds-tag`, `.ds-code`, `.ds-data-table`;
- workbench composition: `.ds-workbench`, `.ds-workbench-grid`, `.ds-workbench-title`, `.ds-workbench-lead`, `.ds-workbench-actions`, `.ds-workbench-card`, `.ds-eyebrow-chip`, `.ds-muted-list`, `.ds-proof-list`;
- loading states: `.ds-loading-state`, `.ds-spinner`.

The previous `.refarm-*`, `data-refarm-theme`, and `data-refarm-scroll-region`
forms remain aliases so existing host apps can migrate incrementally.

Host packages should keep domain logic local and consume these classes for
agnostic presentation. For example, Homestead owns stream node rendering while
the DS owns the generic pill, panel, card, badge, workbench, and scroll-region
styling.

## Token source (DTCG) & multi-platform exports

Themes are authored **once** as W3C [DTCG](https://www.designtokens.org/) token files
(`src/tokens/<theme>.tokens.json`) — the single source of truth. Everything else is
**generated** from it (`pnpm -C packages/ds run generate`), so one design decision projects to
every surface:

| Surface | Output | Consume |
|---|---|---|
| Web (CSS) | `src/themes/<theme>.css` | `@refarm.dev/ds/themes/<theme>.css` |
| JS / TUI / agent | `BUILTIN_THEMES` (`DsTheme` objects) | `import { BUILTIN_THEMES } from "@refarm.dev/ds"` |
| Sass | `src/platforms/scss/<theme>.scss` | `@refarm.dev/ds/platforms/scss/<theme>.scss` |
| iOS | `src/platforms/ios/<Theme>Tokens.swift` | `@refarm.dev/ds/platforms/ios/<Theme>Tokens.swift` |
| Android | `src/platforms/android/<theme>.xml` | `@refarm.dev/ds/platforms/android/<theme>.xml` |
| Flutter | `src/platforms/flutter/<theme>.dart` | `@refarm.dev/ds/platforms/flutter/<theme>.dart` |

Division of labour: a small in-repo emitter owns the bespoke web CSS (the scoped `@layer` +
white-label dual selector) and the `DsTheme` objects; **Style Dictionary** owns the platform
exports (SCSS/iOS/Android/Flutter), where it transforms colors to each platform's native type
(`#238636` → `UIColor(red: 0.137, …)`, `#ff238636`, `Color(0xFF238636)`). Both read the same DTCG
source, so nothing can diverge — a drift-guard test re-runs each generator and asserts byte
equality with the committed files. Native exports use each theme's base palette.

To change a token, edit the DTCG source and regenerate — never hand-edit a generated file. See the
projection live across every surface:

```bash
pnpm -C packages/ds run demo
```

Consuming a built-in theme on a non-web surface (no CSS involved):

```ts
import { BUILTIN_THEMES, projectThemeToTui } from "@refarm.dev/ds";
const terminal = projectThemeToTui(BUILTIN_THEMES["verde-jardim"]); // ANSI colors for a TUI
```

## HTML helpers

Use `@refarm.dev/ds/html` when a consumer needs build-free HTML strings over DS
classes without installing Homestead, Astro, runtime, sync, or storage packages.
The helpers are isomorphic and safe for server-side rendering, static generation,
CLI/admin documents, and browser-side composition.

```ts
import { cardHtml, documentHtml } from "@refarm.dev/ds/html";

const bodyHtml = cardHtml({
	title: "Vault",
	rows: ["<p>Ready</p>"],
});

const html = documentHtml({
	title: "Admin",
	theme: "verde-jardim",
	bodyHtml,
});
```

`documentHtml` links the DS CSS assets under `/_ds` by default. Set `assetBase` if
the host serves `tokens.css`, theme CSS, and `components.css` from another path.

## DS lint

Use `@refarm.dev/ds/lint` to run the first `ds-lint:v1` rules over a rendered DOM
snapshot. The package owns the rules; each consumer owns how it collects the
snapshot from Playwright, a browser harness, or another renderer.

```ts
import { runDsLint } from "@refarm.dev/ds/lint";

const report = runDsLint({
	viewport: { width: 390, height: 844 },
	elements: [
		{
			id: "hero-title",
			tagName: "h1",
			text: "Refarm supply stack",
			styles: {
				color: "#f0f6fc",
				backgroundColor: "#0d1117",
				fontSizePx: 34,
				fontWeight: 800,
				fontSizeExpression: "clamp(2rem, 7vw, 3.5rem)",
			},
			metrics: {
				clientWidth: 342,
				scrollWidth: 342,
				boundingBox: { x: 24, y: 120, width: 342, height: 92 },
			},
		},
	],
});
```

The first rules are generic: contrast for every text/background pair, overflow
against element and viewport bounds, `clamp()` for headings, and heading
hierarchy. Effects are not banned by name; low-quality execution fails.

### quality:v1 adapter

Use `@refarm.dev/ds/quality-checker` when a host wants the same `ds-lint:v1`
engine to participate in a `quality:v1` maker/checker loop. `ds-lint` remains
the owner of UI rules; the adapter maps a `QualityProfile` to `DsLintOptions`
and maps `DsLintIssue` objects to `QualityFinding` objects.

```ts
import { createDsQualityChecker } from "@refarm.dev/ds/quality-checker";

const checker = createDsQualityChecker();
const findings = await checker.check(snapshot, {
	name: "ui-default",
	rules: [
		{
			id: "ds-contrast",
			severity: "fail",
			description: "Text contrast should meet WCAG AA.",
			check: { type: "contrast" },
		},
	],
});
```

## Scroll region utilities

Use explicit scroll regions instead of relying on document/page scroll when a host owns the viewport.

```html
<section class="ds-scroll-region" aria-label="Inspector log">...</section>
<section class="ds-scroll-region-y" aria-label="Event stream">...</section>
<div class="ds-scroll-region-x" aria-label="Wide data table">...</div>
```

Equivalent data attributes are available for host/surface protocols:

```html
<main data-ds-scroll-region="main">...</main>
<section data-ds-scroll-region="y">...</section>
<div data-ds-scroll-region="x">...</div>
```

The utilities set bounded overflow, containment, stable scrollbar gutters, and theme-aligned scrollbars. Nested scroll regions should be labelled when their purpose is not obvious.

See [`docs/HOMESTEAD_SHELL_LAYOUT.md`](../../docs/HOMESTEAD_SHELL_LAYOUT.md) for the Homestead viewport shell contract.

## Usage

```bash
# Start Storybook
npm run storybook

# Build styles
npm run build
```

See [ROADMAP.md](./ROADMAP.md) for the path to the "UI-as-a-Node" vision.
