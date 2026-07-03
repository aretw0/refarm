# Refarm / vault-seed Release Convergence Plan

> Status: ordering note for the next release slices. This is not a new control
> plane; it is the short walk that keeps Refarm useful as its own daily driver
> while making `vault-seed` a real consumer proof for white-label POCs.

## Current read

The operator loop is green:

- `refarm resume --json` returned runtime ready and no required continuation.
- `refarm check --next-action --json` returned `ok: true` with no next action.
- `node packages/toolbox/src/cli.mjs reso status` showed the checkout in a
  mostly published/dist posture, with expected local app/tooling packages.

The active release pressure is still the same: Refarm supplies product-neutral
blocks; `vault-seed` keeps its `dgk` product, vocabulary, notebooks, vault UX,
and provider-specific adapters downstream.

## What is ready to hand off

The current `vault-seed-ready` packet was generated on 2026-07-03:

```bash
pnpm --silent run release:vault-seed:handoff -- --pack --prune-extra --json --out .refarm/handoff/vault-seed/2026-07-03/manifest.json
pnpm --silent run release:vault-seed:handoff -- --out .refarm/handoff/vault-seed/2026-07-03/manifest.md
```

Generated packet:

- directory: `.refarm/handoff/vault-seed/2026-07-03/`
- files: 20 package tarballs, `manifest.json`, and `manifest.md`
- acceptance: accepted
- checks: 4 required gates, 58 required checks
- integrity: no missing tarballs, no extra tarballs, no manifest issues
- distribution evidence: `local-handoff-ready`
- boundary audit: ok, 20 audited packages, zero issues
- consumer proofs: 20 downstream proof targets recorded in the manifest

The external source caches were also materialized on 2026-07-03 with:

```bash
pnpm run consumer:sources:cache -- --json
```

The cache is now configuration-driven by `refarm.consumer-source-caches.json`
instead of a hardcoded script list. In the devcontainer, the configured root is
`/home/vscode/.cache/checkouts`, backed by the named Docker volume
`refarm-source-checkouts`, so cached consumer checkouts survive container
rebuilds.

Cache evidence:

- `agents-lab`: `/home/vscode/.cache/checkouts/github.com/aretw0/agents-lab`,
  head `89f33b0d868b859c6f170c38a8b8dc9ff0a9f970`, clean.
- `vault-seed`: `/home/vscode/.cache/checkouts/github.com/aretw0/vault-seed`,
  head `a8b858cb042c9cd164f6e0a7cc0f69da6d1e2707`, clean.
- `pnpm run native:skills:agents-lab-git-workflow-smoke` passed against the
  cached `agents-lab` checkout.
- `pnpm run native:skills:dgk-vault-search-smoke` passed against the cached
  `vault-seed` checkout.

Release-lane assimilation added during this slice:

- `@refarm.dev/ds/quality-checker` wraps the existing `ds-lint:v1` engine as a
  `quality:v1` UI checker. `ds-lint` remains the rule engine; the adapter maps
  `QualityProfile` rule `check.type` values (`contrast`, `overflow`,
  `fluid-type`, `heading-hierarchy`) to `DsLintOptions` and maps `DsLintIssue`
  output to `QualityFinding`.
- Focused proof passed:
  `pnpm --filter @refarm.dev/quality-contract-v1 run build && pnpm --filter @refarm.dev/ds test -- quality-checker`.
- Package proof passed:
  `pnpm --filter @refarm.dev/ds type-check`,
  `pnpm --filter @refarm.dev/ds run build`, and
  `node scripts/validate-packages.mjs`.
- The `vault-seed-ready` handoff was rematerialized after this package change;
  `@refarm.dev/ds` tarball SHA-256 is now
  `9504c4682971338fc4d7c70e288c03c0be7a8619b415b7a45348a7a5dbe4c48b`.
- The three-track PoC convergence read is captured in
  `docs/superpowers/plans/2026-07-03-poc-release-convergence-matrix.md`. It
  keeps Refarm responsible for generic substrate, `vault-seed` responsible for
  product-facing vault wrapping, and private PoCs responsible for last-mile
  specifics.
- `@refarm.dev/content-projection` now supplies the first generic MD/MDX
  projection block: frontmatter, wikilinks, and inline Markdown links are
  projected into valid `records:v1` records, with external inline Markdown links
  preserved as metadata while acquisition, folder mapping, vocabulary,
  rendering, and vault UX stay downstream-owned.

The official downstream handoff should copy `manifest.json`, `manifest.md`, and
every `.tgz` named by `consumerInstall.copyFiles` from that directory. The
official checkout must verify `packages[].sha256`, refresh `vendor/*.tgz`,
refresh lockfile integrity for changed `file:` tarballs, and then run the
consumer proofs named by `consumerProofs`.

## What only the official checkout can prove

This devcontainer could not see the declared `vault-seed` workspace path:

```bash
refarm workspace execution --workspace vault-seed --json
```

Result: no declared or bridged path was visible. The expected cache root
`/home/vscode/.cache/checkouts` is now only a source-evidence cache, not the
official consumer workspace. That means this checkout can prepare and verify the
Refarm-side packet and read downstream context, but cannot claim official
assimilation.

The official `vault-seed` proof should record:

- exact handoff directory or copy source;
- copied tarball list and sha256 verification;
- direct dependency `file:./vendor/*.tgz` specs used;
- `pnpm.overrides` or equivalent unpublished transitive overrides used;
- lockfile refresh/reinstall step when tarball bytes changed without a version
  bump;
- consumer proof commands and their results;
- product boundary confirmation: `dgk` command labels, vault UX, PARA language,
  provider adapters, notebooks, and publication copy stay downstream.

## Walking order

1. Keep the operator loop green before each slice:

   ```bash
   refarm resume --json
   refarm check --next-action --json
   ```

2. Treat the 2026-07-03 `vault-seed-ready` packet as the next outbound
   artifact. Do not add more package surface to the selection until the official
   checkout either accepts it or reports a concrete gap.

3. If the official checkout is not mounted, refresh the read-only cache instead
   of guessing. `pnpm run consumer:sources:cache -- --json` materializes the
   configured `source-git` caches under `REFARM_SOURCE_CACHE_ROOT`; the
   project-owned defaults are `agents-lab` and `vault-seed`. Use `--target` for
   temporary private context that should live only in the persistent cache
   volume, and `--offline` to report/reuse existing caches without fetching.

4. When the official checkout reports a gap, classify it before coding:

   - package acceptance or release smoke -> `@refarm.dev/release-engine`
   - `dgk` command process evidence -> `@refarm.dev/process-handoff`
   - Lab/outbox/notebook evidence -> `@refarm.dev/artifact-contract-v1`
   - channel receipts, rate limits, review gates -> `@refarm.dev/channel-policy-v1`
   - credentials and namespaces -> `@refarm.dev/silo`, `credentials:v1`,
     `identity:v1`, `storage:v1`
   - source capture, records, enrichment -> `source:v1`, `records:v1`,
     `enrichment:v1`
   - style/static admin UI -> `@refarm.dev/ds` and `@refarm.dev/ds/html`
   - `dgk` product language, notebooks, provider APIs, PARA, Astro rendering,
     Obsidian launchers -> keep in `vault-seed`

5. After each Refarm source edit, run the normal finish gate:

   ```bash
   refarm agent finish --lane after-edit --run --json
   ```

6. Only after an atomic commit, run the after-commit lane:

   ```bash
   refarm agent finish --lane after-commit --run --json
   ```

## Release posture

This is still a candidate channel, not a public install contract. The release
label is earned by repeated use:

- Refarm daily-driver loop stays boring.
- `vault-seed` consumes candidate blocks without losing its product identity.
- POC consumers get white-label substrate through packages, manifests, and
  codemods, not through forced Refarm branding.
- Evidence is written into generated manifests, docs, or source-level contracts
  before it is treated as memory.
