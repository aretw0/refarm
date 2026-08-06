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
| `npm run diagrams:check` | `REFARM_DIAGRAM_SYNC_STRICT=0 scripts/check-diagrams.mjs --ci` | `mermaid.config.json` (branded) | Regenerate + report drift loudly; does not exit non-zero locally (see "Known gap" below) |

Both scan `docs/`, `specs/diagrams/`, and `examples/` (each example ships its own diagram set
next to its code). The old neutral-theme `diagrams:generate` / `diagrams:watch` scripts were
removed — they predated the design system and applied the wrong theme.

## Known gap: diagram drift is currently ungated on every surface

Neither the local `diagrams:check` command nor CI can currently fail a build because a
`.svg` has drifted from its `.mermaid` source. Before 2026-08-06 the local script ran
with no flags at all (an unconditional regenerate, always exit 0). CI does pass `--ci`
(`.github/workflows/validate-diagrams.yml`), which is the only mode that compares
against git status — but CI also sets `REFARM_DIAGRAM_SYNC_STRICT=0` explicitly on that
same invocation, and `scripts/check-diagrams.mjs`'s `--ci` path prints the drifted-file
list and then *returns* instead of reaching `process.exit(1)` whenever that variable is
`"0"` (see the script, `STRICT_SVG_SYNC` / the `if (!STRICT_SVG_SYNC)` branch around the
git-status check). So a genuine drift — someone edits a `.mermaid` and forgets to commit
the regenerated `.svg` — is reported as a warning and passes both locally and in CI
today. `diagrams:check` now (as of this session) also sets
`REFARM_DIAGRAM_SYNC_STRICT=0`, for the reason below, so it is honest about this: it
reports, it does not gate.

**Root cause**: SVG rendering is not reproducible across `mmdc`/puppeteer/Chrome
versions. CI pins one via `node scripts/ci/install-puppeteer-browser.mjs` before running
the check; a local checkout has no equivalent step and renders with whatever Chrome
`puppeteer` resolves on that machine. The practical effect, measured on one such
machine: about 35 of this repo's diagrams differ from their committed `.svg` by
rendering-only bytes on every single run, with no `.mermaid` source having changed —
noise indistinguishable, to the script, from a real drift.

**Why `REFARM_DIAGRAM_SYNC_STRICT=0` is set locally too, deliberately, rather than left
strict by default**: making the local script strict without also pinning the same
browser CI pins would make `diagrams:check` fail on every run regardless of whether
anything real drifted — training whoever runs it to ignore its exit code, which is the
same defect as never being able to fail at all, just inverted. The command now reports
loudly (drift is printed and named) without crying wolf (exit 0), which is the most
honest state achievable without addressing the root cause.

**The fix path, not done here**: make local runs pin the same browser CI does (extend
`scripts/ci/install-puppeteer-browser.mjs` or equivalent to local `pnpm run
diagrams:fix`/`diagrams:check`), and only once that holds, consider removing
`REFARM_DIAGRAM_SYNC_STRICT=0` from the CI workflow so a real drift can fail a build.
Flipping CI to strict before local rendering is pinned, or without independently
verifying CI's pinned browser actually produces byte-stable output run over run, is
**not done here** — that determination needs evidence this environment cannot produce,
and is left to whoever owns the CI runner's browser pin. Until both hold, a `.mermaid`
source can drift from its committed `.svg` and nothing in this repository's tooling
will say so with a failing exit code — only a human reading the warning text will
notice.

This is recorded here — the diagram tooling's own source-of-truth doc — rather than in
`docs/SOVEREIGN_RECORD_ORDERING.md`: that document is specifically about the
`query_nodes` read-ordering contract, and diagram-drift gating is a different
instrument entirely. It belongs next to the scripts it describes.

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
