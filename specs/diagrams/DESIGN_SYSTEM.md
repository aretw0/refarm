# Mermaid Design System

This file defines how diagram styling is centralized in Refarm.

## Source of Truth

- Global config: [mermaid.config.json](./mermaid.config.json)
- Diagram sources: `*.mermaid`
- Rendered artifacts: `*.svg`

All SVG generation runs through `scripts/check-diagrams.mjs`, which applies the global config automatically.

## Canonical vs Legacy Scripts

| Command | Script | Theme | Status |
|---------|--------|-------|--------|
| `npm run diagrams:fix` | `scripts/check-diagrams.mjs` | `mermaid.config.json` (branded) | **Canonical — use this** |
| `npm run diagrams:check` | `scripts/check-diagrams.mjs` | `mermaid.config.json` (branded) | CI verification |
| `npm run diagrams:generate` | `scripts/ci/generate-diagrams.mjs` | "neutral" (Mermaid default) | **Legacy — do not use for new diagrams** |
| `npm run diagrams:watch` | `scripts/ci/generate-diagrams.mjs` | "neutral" | **Legacy** |

> `diagrams:generate` / `diagrams:watch` predate the design system and apply the Mermaid "neutral"
> theme instead of the branded token set. Do not use them for new diagrams. They remain in
> `package.json` for backwards-compatibility only.

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
