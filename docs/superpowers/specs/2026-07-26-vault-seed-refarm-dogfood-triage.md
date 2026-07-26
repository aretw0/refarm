# vault-seed ⇄ refarm — first dogfood triage (the pains, proven)

> 2026-07-26. The first seed of the cultivation arc: refarm empowering vault-seed for real, locally,
> before any official release. Goal was to *feel the pains*. It did. This records what works, the
> ropes the real consumer proved, and the fix path — so the repair is a focused effort, not a
> re-discovery. Companion to `docs/2026-07-25-v0.1.0-release-readiness.md` (the ropes documented in
> the abstract; here they bite).

## What vault-seed is, and how it consumes refarm

`~/github/vault-seed` = **`digital-gardening-kit` (DGK)** — a mature monorepo (site, CLI, obsidian,
PARA) that consumes refarm as an **SDK** and keeps only the thin product layer (labels, `dgk` commands,
vocab, views). It already imports **~12 `@refarm.dev/*` blocks** (ds, health, silo, process-handoff,
channel-policy, local-surface, enrichment, records, source-web, content-projection, quality, ds-astro),
**each with a green consumer contract test**, vendored via `file:vendor/*.tgz` under a whole doctrine
(`docs/convergencia-*.md`). The last official handoff was **2026-07-03** (refarm `4f0e058d`) — stale,
and `vendor/` was empty, so vault-seed no longer installed.

## What works

The **handoff regenerates against today's refarm.** `pnpm run release:vault-seed:handoff -- --pack`
produced 23 tarballs + manifest + proof into `.refarm/handoff/vault-seed/<date>`, `sourceGitSha`
`e59408503d…` (current HEAD), boundary audit `ok`. The production machine is sound; the pain is in the
path's ergonomics and dependency-closure.

## The pains (ropes proven by the real consumer)

1. **Handoff `--pack` footgun.** `release:vault-seed:handoff` with no flag skips packing and jumps to
   the boundary audit, which then reports "missing expected tarball" for all 23. Misleading. → pack by
   default, or fail with "run with --pack".
2. **Rope #1 — build-before-publish.** `materializeHandoffTarballs` only runs `pnpm pack`; it never
   builds. It worked here only because packages were already built this session; a clean checkout would
   pack tarballs with no `dist`. → the handoff (or a required pre-step) must build the selection first.
3. **Rope #2 — the handoff is NOT dependency-closed (the real blocker).** `@refarm.dev/health` depends
   transitively on `@refarm.dev/config`, which the handoff does **not** vendor. So vault-seed's
   `pnpm install` can't resolve `@refarm.dev/config` (unpublished on npm) → the graph is incomplete →
   `vitest` and everything else is never linked → **every** consumer contract test dies at import with
   `Cannot find package 'vitest'`. The leak, not an API break, is what fails everything.

   **Deeper finding (the design tension):** the obvious fix — add `config` to the `vault-seed-ready`
   *selection* — **fights the boundary-audit model.** `release-boundary-audit.mjs` requires every
   selected package to carry a *selected consumer proof* (`packageName must stay out of vault-seed-ready
   until a selected consumer proof exists`, line ~235). `config` is transitive infrastructure with no
   direct consumer proof, so the audit correctly blocks it. Adding it to the selection leaves the
   handoff `blocked`.

   **The right fix** already has a home in the handoff's own output: `consumerInstall.pnpmOverrides`,
   documented for "unpublished transitive `@refarm.dev/*` packages". So the handoff should compute and
   **vendor the transitive `@refarm.dev` closure** (config, and any other) and declare it in
   `consumerInstall.pnpmOverrides` — **without** selection membership. That closes the leak while
   respecting the consumer-proven-only selection model.
4. **Environment — corporate Nexus.** vault-seed inherited the Serpro Nexus registry from the global
   `~/.npmrc`; install was slow/hung. Fixed with a repo-local `.npmrc` → public npm (mirrors refarm's
   fix; the developer's global config for work repos is untouched). **[applied to vault-seed]**

## Fix path (the focused convergence pass)

1. Handoff UX: pack-by-default or a clear "--pack required" error. *(open)*
2. Handoff: build the `vault-seed-ready` selection before packing (rope #1). *(open)*
3. **DONE (commit `ddd4d169`) — rope #2 closed.** `computeTransitiveRefarmClosure` walks the selected
   packages' `@refarm.dev` deps, finds those NOT in the selection (`config`), and the handoff now packs
   them and declares them in `consumerInstall.pnpmOverrides` + `copyFiles` — **without** selection
   membership (so the boundary audit stays `ok`; config is not a consumer-pulled block). Verified:
   handoff Status `ok`, 23 selected + 1 transitive (`config`); config in `pnpmOverrides`, not
   `fileSpecs`/`packages[]`. Closure logic is unit-tested.
4. **DONE — the real triage ran, and it's green.** Re-vendored the 24-tarball handoff into vault-seed,
   added the `@refarm.dev/config` override to its `pnpm-workspace.yaml`, and `pnpm install` **completed**
   (18.8s, `vitest` linked — the graph resolves now). Then the consumer contract tests, run **via
   vitest** (not `node --test` — they use vitest's runner): **43/43 tests green across 16 files.** After
   months of refarm evolution the convergence held almost entirely; the **only** drift was a
   brand-agnostic rename — `@refarm.dev/local-surface` dropped the `refarm.` prefix from its schema ids
   (`refarm.local-surface.v1` → `local-surface.v1`, `…launch-plan.v1` → `local-surface.launch-plan.v1`,
   ADR-087). vault-seed's contract test was stale; updated to the new ids → green.

## Bottom line

The first cultivation seed is **proven end-to-end**: the handoff regenerates against today's refarm,
is now dependency-closed (rope #2 fixed in refarm, `ddd4d169`), and vault-seed — the real consumer —
installs it and passes all 43 consumer contracts. The `--pack` UX and build-before-publish ropes
(items 1–2) remain open but did not block the loop this session. Next seeds: those two ergonomics
fixes, assessing *new* refarm blocks to assimilate, and the doceria (the external commerce seed).

### Changes left in vault-seed (`~/github/vault-seed`, its own repo — commit there)
`.npmrc` → public npm (Nexus bypass); `pnpm-workspace.yaml` overrides += `@refarm.dev/config`;
re-vendored 24 tarballs in `vendor/`; `scripts/refarm_local_surface_consumer_contract.test.mjs` schema
ids updated to the brand-agnostic form.

## State left

refarm is clean (the exploratory `config` selection change was reverted — it fights the model; the
transitive-closure fix above is the right one). vault-seed keeps the `.npmrc` fix and a partial
re-vendor (23 stale tarballs; install incomplete pending the config closure). The dogfood proved the
loop and the ropes; the repair above is the next focused seed.
