# @refarm.dev/ds

The Design System (DS) is the source of truth for visual tokens, styles, and headless UI primitives shared by Refarm and downstream ecosystem apps.

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

The previous Refarm-specific theme attribute remains an alias:

```html
<body data-refarm-theme="tractor-green">
```

Available themes are `tractor-green`, `oceano`, `terracota`, and `verde-jardim`.
`verde-jardim` also ships a Lab-proven light override; set `data-mode="light"`
on the themed element or an ancestor to use it. The unqualified preset remains
dark for backward compatibility.
`tokens.css` never writes contract variables to bare `:root`; `--ds-*` aliases
are scoped under `[data-ds-theme]` and `[data-refarm-theme]`. Legacy
`--refarm-*` aliases are still emitted for existing Refarm app surfaces.

Import `@refarm.dev/ds/styles/styles.css` once in a host shell to expose shared,
framework-agnostic primitives:

- layout: `.ds-grid`, `.ds-stack`, `.ds-cluster`, `.ds-split-grid`, `.ds-scroll-region`, `.ds-scroll-region-y`, `.ds-scroll-region-x`;
- surfaces: `.ds-surface`, `.ds-surface-tinted`, `.ds-panel`, `.ds-surface-card`, `.ds-card-roomy`;
- actions: `.ds-btn`, `.ds-btn-primary`, `.ds-btn-pill`;
- data display: `.ds-pill`, `.ds-badge`, `.ds-tag`, `.ds-code`, `.ds-data-table`;
- workbench composition: `.ds-workbench`, `.ds-workbench-grid`, `.ds-workbench-title`, `.ds-workbench-lead`, `.ds-workbench-actions`, `.ds-workbench-card`, `.ds-eyebrow-chip`, `.ds-muted-list`, `.ds-proof-list`;
- loading states: `.ds-loading-state`, `.ds-spinner`.

The previous `.refarm-*`, `data-refarm-theme`, and `data-refarm-scroll-region`
forms remain aliases so current Refarm apps can migrate incrementally.

Host packages should keep domain logic local and consume these classes for
agnostic presentation. For example, Homestead owns stream node rendering while
the DS owns the generic pill, panel, card, badge, workbench, and scroll-region
styling.

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
