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
| `npm run diagrams:check` | `scripts/check-diagrams.mjs --ci` | `mermaid.config.json` (branded) | Regenerate + fail on drift. Strict by default — will FAIL on this machine until the browser is pinned locally (see "Known gap" below). Local escape: `REFARM_DIAGRAM_SYNC_STRICT=0 pnpm run diagrams:check`. |
| `pnpm run diagrams:browser:plan` | `install-puppeteer-browser.mjs --dry-run` | — | Show Mermaid CLI's exact browser revision without downloading it. |
| `pnpm run diagrams:browser:install` | `install-puppeteer-browser.mjs` | — | Install that revision into the Puppeteer cache. |

Both scan `docs/`, `specs/diagrams/`, and `examples/` (each example ships its own diagram set
next to its code). The old neutral-theme `diagrams:generate` / `diagrams:watch` scripts were
removed — they predated the design system and applied the wrong theme.

## Known gap: local strictness will fail here until the browser is pinned

`npm run diagrams:check` runs `scripts/check-diagrams.mjs --ci` with **no baked env
override** — strictness is decided entirely by whoever calls it, as the script was
designed. That means:

- **Drift is computed everywhere.** Both the local script and CI run the same `--ci`
  path: regenerate every SVG, then compare against `git status`. Neither surface skips
  the comparison; there is exactly one code path (`STRICT_SVG_SYNC` in
  `scripts/check-diagrams.mjs`) that decides only what happens *after* drift is found.
- **CI chooses advisory, explicitly, and that is a decision, not an accident.**
  `.github/workflows/validate-diagrams.yml` invokes
  `REFARM_DIAGRAM_SYNC_STRICT=0 pnpm run diagrams:check` — the workflow sets the
  variable itself, on the command line, every run. When `STRICT_SVG_SYNC` is false,
  `scripts/check-diagrams.mjs` prints the full drifted-file list and then *returns*
  instead of reaching `process.exit(1)`. CI can, today, observe real drift and pass
  anyway. That is CI's own choice, made in its own workflow file, not a side effect of
  the local command's default.
- **Local is strict by default, and it WILL fail on this machine.** With no env
  override, `STRICT_SVG_SYNC` is true, so any drift the comparison finds fails the
  command. On an unpinned-browser checkout that means `pnpm run diagrams:check` fails
  today — measured here at 35 of this repo's diagrams differing from their committed
  `.svg` by rendering-only bytes, with no `.mermaid` source having changed. That is the
  honest result: the check reports drift it genuinely observes, and this environment
  genuinely produces drift. There is no configuration that is both strict-by-default
  and quiet on an unpinned browser — accepting the failure is the correct state, not a
  bug to route around.
- **The local escape hatch, named rather than hidden**: `REFARM_DIAGRAM_SYNC_STRICT=0
  pnpm run diagrams:check` reports the same drift list without failing, for a
  developer who has verified by hand that what's listed is rendering noise, not a real
  source change. This is a manual, per-invocation opt-out — it is not, and must not
  become, the command's baked-in default; an npm-script env prefix would shadow any
  value a caller (including CI) tries to set, which is exactly the mistake this section
  exists to record.

**Root cause**: SVG rendering is not reproducible across `mmdc`/puppeteer/Chrome
versions. CI installs a browser before running the check. Local checkouts now expose
the same explicit operation through `pnpm run diagrams:browser:install`; checks do not
download implicitly.

**The fix path, in order**: **first**, inspect with `pnpm run diagrams:browser:plan`,
then install with `pnpm run diagrams:browser:install`. The installer resolves Puppeteer
from Mermaid CLI itself instead of choosing an unrelated installed `puppeteer-core` by
directory ordering. **Only after** repeated renders with that browser are verified as
byte-stable should we reconsider `REFARM_DIAGRAM_SYNC_STRICT=0` in
`.github/workflows/validate-diagrams.yml` — whether CI's current advisory choice should
become strict is the operator's call, not something to flip as a side effect of a local
convenience fix. Until browser pinning happens, a `.mermaid` source can drift from its
committed `.svg` and CI will not say so with a failing exit code; locally, the command
will now say so reliably, at the cost of also flagging this environment's own
rendering noise until it's pinned.

**This is the sixth instrument in this line of work found reporting a result it had
not earned — and this one was introduced by the fix for the fifth.** The fifth was
`diagrams:check` itself running with no flags, unable to fail by construction. The fix
for it first added `--ci` (correct), then, under pressure to keep the local command
"usable," baked `REFARM_DIAGRAM_SYNC_STRICT=0` into the npm script to silence this
machine's noise — which made the check unconditionally unable to fail again, through a
different mechanism, and as a second-order effect made the workflow's own
`REFARM_DIAGRAM_SYNC_STRICT=0` a dead no-op (an inline `VAR=val` prefix in an npm
script always wins over anything a caller exports). The lesson worth keeping: a
convenience edit made to stop a check from being noisy is exactly as capable of making
it unable to fail as never wiring the check up at all, and it is *more* dangerous,
because it looks like a fix instead of an omission.

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
