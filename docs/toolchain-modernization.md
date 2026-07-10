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

## Astro 6 → 7 — DONE (28d8490f)

Migrated all Astro workspaces from `^6.4.8` to Astro 7 (resolved `7.0.3`). The
[`astro-6-to-7`](../codemods/astro-6-to-7.mjs) codemod's dry-run + source/config
scan found **zero** breaking-change findings (no `experimental.*` flags, no
`@astrojs/db`, no `astro:transitions` internals, no reserved `src/fetch.ts`) — the
central `@refarm.dev/config/astro` `defineConfig` was already Astro-7-clean, so it
was purely version bumps:

- `apps/dev`, `apps/me`, `apps/site`, `packages/homestead` → `astro ^7.0.0`
- `packages/ds-astro` → peer widened `^6.4.8 || ^7`
- `packages/config` → unchanged (`>=6.4.8` already admits 7)

Verified: all 3 apps build, `astro check` on the site is 0/0/0, ds-astro (5) +
homestead (71) + site (4) tests green.

**Applied by hand, not `--write`:** the codemod re-serialized package.json with a
hardcoded 2-space indent, which would have reindented every tab-line. That bug is
now fixed (`ed90d196`, `detectIndent` + regression tests), but the bumps were done
surgically to keep the diff to one line per file.

**Key finding for the formatter (P5):** Astro 7 runs **Rolldown-Vite** — the build
logs show `[plugin rolldown:vite-resolve]`. So the oxc/Rolldown ecosystem is now
live in the stack, which directly informs the oxfmt-vs-Biome call below.

## Formatter — oxfmt (oxc), adopted; sweep in progress (P5)

**Decision: oxfmt** (the oxc formatter). Direction (Arthur): use the oxc ecosystem
— now live in the stack via Astro 7's Rolldown-Vite — and reach for Biome/Prettier
only if a real gap is felt. oxfmt cleared the bar; **no gap felt**, so no
Biome/Prettier.

Validated at the source before adopting:

- `oxfmt@0.58` — published, actively maintained (updated days ago), Prettier-
  compatible, TypeScript-aware. (`oxlint@1.x` is the mature sibling linter, held
  for later.)
- **Respects tabs** — with `useTabs: true`, a clean hand-written file produces a
  ZERO diff (our idioms already match oxfmt's output). Changes on messier files
  are sensible line-wraps (long strings, multi-clause conditions, method chains),
  never corruption.
- **Idempotent** (format twice = same — a stable `--check` gate), **strict config
  validation** (rejects unknown keys), **fast** (900 files in ~1.4s, Rust).
- Config: [`.oxfmtrc.json`](../.oxfmtrc.json) — `useTabs`, `printWidth: 100`
  (matches our p99 line length ≈104), Prettier defaults otherwise. oxfmt honors
  `.gitignore`.

Scripts: `pnpm format` (write) / `pnpm format:check` (gate). It supersedes the
home-grown `imports` tool (which corrupted indentation — the footgun that also bit
the astro codemod).

**Rollout — DONE (sliced).** ~714/900 files were reformatted across format-only
commits sliced by area: contract-v1 packages → cli/capabilities → remaining non-§8
packages → §8 packages (tractor-ts, plugin-manifest, flagged) → apps/refarm →
farmhand/dev/me/examples. Each slice was verified behavior-neutral (type-check +
tests) before committing, so whitespace churn never mixed with logic. `pnpm
format:check` is now GREEN across all 900 files.

**Gate:** `format:check` is wired into the non-§8 `factory:pre-rebuild` composite
(beside `git:diff-check` and `imports:organize:check`). Adding it to the CI
workflows (`.github/workflows/test.yml`'s turbo step) is a §8 change — a tracked
follow-up, not done here.

**Notes:**
- oxfmt and the toolbox `imports` tool are complementary: oxfmt does whitespace /
  wrapping; `imports` does import ordering. Both run in the gate.
- oxfmt 0.58 quirk: certain `.fn().method({ …object… })` chains need a **second
  pass** to converge (it expands then re-collapses). Rare; `format` twice if a
  fresh `format:check` flags a file the first `format` just wrote. Stable after.

## Sequence

1. ✅ Vite/Vitest convergence — already done (vtconfig); node:test exceptions
   documented above.
2. ✅ Reconcile the two pre-existing stale release-selection snapshots surfaced
   while surveying this (release-engine + apps/site now track the 23-package
   `vault-seed-ready` policy).
3. ✅ Astro 6 → 7 (28d8490f) — zero breaking findings; all apps build + check
   clean on 7.0.3; brought Rolldown-Vite/oxc into the stack.
4. ✅ Formatter (P5) — oxfmt adopted; whole repo swept (900 files green);
   `format:check` gated in `factory:pre-rebuild`. CI-workflow gating is a §8
   follow-up.
5. ⏸️ TypeScript 7 — assessed, **DEFERRED** (not a drop-in; see below).

## TypeScript 7 — assessed, deferred

`typescript@7.0.2` is the **native Go compiler** ("Corsa"/tsgo) shipped as the main
`typescript` package — not a routine bump. Evidence: 20 per-platform binary deps
(`@typescript/typescript-linux-x64`, …); the package shrank 24 MB → 2.5 MB (the JS
implementation is gone, replaced by a thin wrapper over the native binary).

Isolated trial (repo untouched):

- ✅ `tsc --noEmit` (type-check) works.
- ✅ `tsc --declaration --outDir` (emit `.d.ts` + `.js`) works — our TS-strict build
  path is fine.
- ❌ **The JS compiler API is removed from the default import.** `require("typescript")`
  no longer exposes `transpileModule` / `createProgram` / `ModuleKind` (all
  `undefined`); the API moved to explicitly-**`unstable/`** subpaths
  (`typescript/unstable/ast`, `/unstable/sync`, …) with a reorganized shape.

That breaks real consumers here:

- `packages/toolbox/src/imports.mjs` — our import organizer (15 API calls:
  `createLanguageService`, `createSourceFile`, `isImportDeclaration`, …). Hard
  dependency on the full AST/LanguageService API.
- `apps/site/test/site-data.test.mjs` — `ts.transpileModule`.
- `scripts/ci/test-turbo-generators.mjs`.
- `typescript-eslint` (our repo-wide `pnpm lint`) consumes the TS API internally;
  TS 7-native compat is an open area needing its own release.

**Verdict:** unlike Astro 7 (zero findings) and oxfmt (zero corruption), TS 7 today
costs real work against an `unstable/` API. Deferred. Revisit when typescript-eslint
+ the `unstable/` API stabilize (likely 7.1/7.2), or adopt `tsgo` for **type-check
only** (the `--noEmit` path works now) as a surgical, non-breaking half-step.

---

## Status: toolchain modernization CLOSED (for now)

The leva is complete for this pass: Vite/Vitest were already converged; the stale
release snapshots are reconciled; Astro is on 7; oxfmt formats the whole repo with a
gate. TypeScript 7 is assessed and deferred with a clear re-entry condition. Reopen
when TS 7's ecosystem settles, or to wire `format:check` into CI (§8).
