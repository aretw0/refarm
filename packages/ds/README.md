# @refarm.dev/ds

The Refarm Design System (DS) is the source of truth for all visual tokens, styles, and headless UI primitives used across the Refarm ecosystem.

## Features

- **Semantic Tokens**: Managed via CSS variables for color, typography, and spacing.
- **Headless-First**: Focus on accessibility and behavior contracts rather than prescribed visuals.
- **Storybook Included**: Integrated development environment for component testing.

## CSS primitives

Import `@refarm.dev/ds/styles/styles.css` once in a host shell to expose shared,
framework-agnostic primitives:

- layout: `.refarm-grid`, `.refarm-stack`, `.refarm-cluster`;
- surfaces: `.refarm-surface`, `.refarm-surface-tinted`, `.refarm-panel`, `.refarm-surface-card`;
- actions: `.refarm-btn`, `.refarm-btn-primary`, `.refarm-btn-pill`;
- data display: `.refarm-pill`, `.refarm-badge`, `.refarm-tag`, `.refarm-code`;
- workbench composition: `.refarm-workbench`, `.refarm-workbench-grid`, `.refarm-workbench-title`, `.refarm-workbench-lead`.

Host packages should keep domain logic local and consume these classes for
agnostic presentation. For example, Homestead owns stream node rendering while
the DS owns the generic pill, panel, card, badge, and workbench styling.

## Usage

```bash
# Start Storybook
npm run storybook

# Build styles
npm run build
```

See [ROADMAP.md](./ROADMAP.md) for the path to the "UI-as-a-Node" vision.
