# @refarm.dev/ds

The Refarm Design System (DS) is the source of truth for all visual tokens, styles, and headless UI primitives used across the Refarm ecosystem.

## Features

- **Semantic Tokens**: Managed via CSS variables for color, typography, and spacing.
- **Headless-First**: Focus on accessibility and behavior contracts rather than prescribed visuals.
- **Storybook Included**: Integrated development environment for component testing.

## CSS primitives

Import `@refarm.dev/ds/styles/styles.css` once in a host shell to expose shared,
framework-agnostic primitives:

- layout: `.refarm-grid`, `.refarm-stack`, `.refarm-cluster`, `.refarm-split-grid`, `.refarm-scroll-region`, `.refarm-scroll-region-y`, `.refarm-scroll-region-x`;
- surfaces: `.refarm-surface`, `.refarm-surface-tinted`, `.refarm-panel`, `.refarm-surface-card`, `.refarm-card-roomy`;
- actions: `.refarm-btn`, `.refarm-btn-primary`, `.refarm-btn-pill`;
- data display: `.refarm-pill`, `.refarm-badge`, `.refarm-tag`, `.refarm-code`, `.refarm-data-table`;
- workbench composition: `.refarm-workbench`, `.refarm-workbench-grid`, `.refarm-workbench-title`, `.refarm-workbench-lead`, `.refarm-workbench-actions`, `.refarm-workbench-card`, `.refarm-eyebrow-chip`, `.refarm-muted-list`, `.refarm-proof-list`;
- loading states: `.refarm-loading-state`, `.refarm-spinner`.

Host packages should keep domain logic local and consume these classes for
agnostic presentation. For example, Homestead owns stream node rendering while
the DS owns the generic pill, panel, card, badge, workbench, and scroll-region
styling.

## Scroll region utilities

Use explicit scroll regions instead of relying on document/page scroll when a host owns the viewport.

```html
<section class="refarm-scroll-region" aria-label="Inspector log">...</section>
<section class="refarm-scroll-region-y" aria-label="Event stream">...</section>
<div class="refarm-scroll-region-x" aria-label="Wide data table">...</div>
```

Equivalent data attributes are available for host/surface protocols:

```html
<main data-refarm-scroll-region="main">...</main>
<section data-refarm-scroll-region="y">...</section>
<div data-refarm-scroll-region="x">...</div>
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
