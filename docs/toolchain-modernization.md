# Toolchain Modernization — the running map

Bottom-up modernization of the build/test/format stack, driven by the codemods in
[`codemods/`](../codemods/) (each with a `registry.json` entry: status, fixtures,
dry-run, verification gate, rollback). This doc is the running map — what the
factory already has, what is intentional, and what remains — so we stop re-deriving
it every session.

## Test runner + build tool — CONVERGED

The Vite/Vitest convergence is **already done at the source level** and does not
need a sweep:

- **Single source of truth:** [`@refarm.dev/vtconfig`](../packages/vtconfig/package.json)
  declares `vite ^8` + `vitest ^4.1.0` (peer) / `^8.0.16` + `^4.1.9` (dev). Every
  other workspace inherits Vite/Vitest through it — no workspace pins its own.
- **Installed reality:** a single `vitest@4.1.9`. The only `vite@7.x` present is a
  *transitive* dependency of Astro 6; it disappears when Astro → 7 lands (Astro 7
  is on Vite 8).
- So "converge Vite/Vitest" is a no-op — the backbone is unified.

### node:test — two intentional exceptions (not oversight)

~48 workspaces run Vitest. **Two files deliberately stay on `node:test`:**

| file | ~lines | what it tests |
| --- | --- | --- |
| `packages/release-engine/test/release-engine.test.mjs` | ~1700 | the release-plan engine (pure Node tooling) |
| `apps/site/test/site-data.test.mjs` | ~200 | site-data ↔ release policy reconciliation |

**Why keep them (pragmatism):** both test *build/release tooling* authored as
`.mjs`, run standalone via `node --test` with zero config and zero deps, and need
none of Vitest's browser/watch/mock machinery. Migrating ~1900 lines to gain only
runner uniformity is not worth it. The [`node-test-to-vitest`](../codemods/node-test-to-vitest.mjs)
codemod exists if that calculus ever changes.

## Astro 6 → 7 — NEXT (codemod ready, not applied)

Five workspaces are on `astro ^6.4.8`. The [`astro-6-to-7`](../codemods/astro-6-to-7.mjs)
codemod is written and tested — it bumps package.json ranges (`astro ^6 → ^7`,
peer-widening) **and** scans source/config for Astro 7 breakpoints (removed
`experimental.*` flags, `@astrojs/db` removal, `astro:transitions` internals,
container-renderer imports, reserved `src/fetch.ts`). Dry-run first
(`--json`), resolve findings, then `--write` sliced, then `astro check`/`build`.

## Formatter — OPEN (P5)

The repo has **no formatter** — only a home-grown `imports` tool in the toolbox
that corrupts indentation. Style is **tabs**; ~1113 TS files. Direction (Arthur):
prefer the Vite 8 / Rolldown / oxc ecosystem; reach for Biome/others only if they
complement a gap oxc leaves. Open question to settle before adopting: the real
maturity of `oxfmt`/oxlint today vs Biome/Prettier for production formatting.

## Sequence

1. ✅ Vite/Vitest convergence — already done (vtconfig); node:test exceptions
   documented above.
2. ✅ Reconcile the two pre-existing stale release-selection snapshots surfaced
   while surveying this (release-engine + apps/site now track the 23-package
   `vault-seed-ready` policy).
3. **Astro 6 → 7** — apply the ready codemod (sliced, review findings first).
4. **Formatter (P5)** — settle oxfmt-vs-Biome, then adopt with a `format:check`
   gate.
