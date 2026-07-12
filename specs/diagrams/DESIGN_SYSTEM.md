# Mermaid Design System

This file defines how diagram styling is centralized in Refarm.

## Source of Truth

- Global config: [mermaid.config.json](./mermaid.config.json)
- Diagram sources: `*.mermaid`
- Rendered artifacts: `*.svg`

All SVG generation runs through `scripts/check-diagrams.mjs`, which applies the global config automatically.

## Scripts

| Command | Script | Theme | Status |
|---------|--------|-------|--------|
| `npm run diagrams:fix` | `scripts/check-diagrams.mjs` | `mermaid.config.json` (branded) | **Regenerate — use this after editing a `.mermaid`** |
| `npm run diagrams:check` | `scripts/check-diagrams.mjs --ci` | `mermaid.config.json` (branded) | CI verification (regenerate + drift check) |

Both scan `docs/`, `specs/diagrams/`, and `examples/` (each example ships its own diagram set
next to its code). The old neutral-theme `diagrams:generate` / `diagrams:watch` scripts were
removed — they predated the design system and applied the wrong theme.

## Design Tokens (Current)

- Primary surface: blue (`primaryColor` / `primaryBorderColor`)
- Secondary surface: green (`secondaryColor` / `secondaryBorderColor`)
- Tertiary surface: amber (`tertiaryColor` / `tertiaryBorderColor`)
- Base text: slate (`primaryTextColor`)
- Edge/line color: slate (`lineColor`)
- Backgrounds: white/slate shades (`background`, `mainBkg`, `clusterBkg`)

Sequence/state tokens are also centralized (`actor*`, `signal*`, `state*`, `note*`).

## How to Change Style Globally

1. Edit [mermaid.config.json](./mermaid.config.json)
2. Regenerate SVGs:

```bash
npm run diagrams:fix
```

1. Commit config + regenerated SVGs.

## Local Overrides (Use Sparingly)

Use local class definitions (`classDef`) only when a diagram needs semantic emphasis not covered by global theme.

Rule:

- Prefer global token changes first
- Add local overrides only for diagram-specific meaning
