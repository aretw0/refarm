# Runbook — first publish of `evidence-contracts-ready` (0.1.0)

**Status 2026-08-30:** ready on `develop`, waiting for promotion and the operator's dispatch.
Nothing here publishes by itself; every publish-capable step needs `RELEASE_AUTOMATION=true`
and, for the real publish, a typed confirmation.

## What the unit is

`@refarm.dev/artifact-contract-v1`, `@refarm.dev/quality-contract-v1`,
`@refarm.dev/provenance-contract-v1` — zero runtime dependencies, `sdk-primitive` with
`boundary-review`, proven together by a producer that is not JavaScript
(`arch-engine`, receipts under `.refarm/handoff/vault-seed/2026-08-30/receipts/*.arch-engine.json`).
Defined in `refarm.config.json` as the `evidence-contracts-ready` selection (`e8ac2f86`), the same
shape as `design-system-ready`; `quality-contract-v1` sits in both, and the first-publish lane
skips a version the registry already has (`9068e193`), so the two units publish in either order.

## Evidence already on `develop`

| Check | Result | Where |
|---|---|---|
| `release:first-publish:plan -- --selection evidence-contracts-ready` | 3 packages, topological order pinned by test | `scripts/ci/test-release-check.mjs` |
| `release-install-smoke.mjs --selection evidence-contracts-ready` | 3/3 pack → clean pnpm install → import | dependency closure asserted |
| `release:boundary:audit` | ok (25-package `consumer-ready`, incl. the three) | |
| `release:first-publish:check -- --selection consumer-ready` | publish dry-run ok for 25 | |
| `release:readiness:test`, `validation-pocs:test` | green after ISS-112 (`46e76097`) | one wire name: `sovereign.task-artifacts.v1` |
| `refarm agent finish --lane before-push` | ok, security audit included | |
| `release:promote:check` | BLOCKED only by `sourceGreen: false` — `origin/develop` still carries the red runs fixed in `3f3a15f3` (reqbench-t3) and `0cd0c661` (Windows) | `wouldPublish: []`, divergence clean |

## Steps — operator

1. **Push `develop`** and watch `Test & Quality` go green (the two red jobs were
   `quality` → reqbench-t3 build, and `Platform compatibility (windows)` → ESM file URL).
   `pnpm run release:promote:check` must then say `SAFE`.
2. **Open the PR `develop → main`** (WORKFLOW.md §"develop → main"). Merge with the strategy the
   protection allows. On merge, `release-changesets.yml` runs on `main` and — because every
   selected package is still 0.1.0 — its first-publish guard reports `blocked`, so
   `changeset publish` does **not** run. `sync-develop.yml` then aligns `develop`.
3. **Unlock:** set the repository variable `RELEASE_AUTOMATION=true` (the lock that keeps both
   publish-capable workflows skipped). `RELEASE_OWNER` is already `aretw0`.
4. **Dry run:** dispatch *First Publish Selection* on `main` with
   `selection = evidence-contracts-ready`, `dry_run = true`. It runs plan → boundary audit →
   install smoke for the selection → publish dry-run. Read the summary.
5. **Publish:** dispatch again with `dry_run = false` and
   `confirm = publish-evidence-contracts-ready-0.1.0`. Three `pnpm publish --access public
   --provenance` runs, in order; an already-published exact version is skipped.
6. **Re-lock:** set `RELEASE_AUTOMATION=false` again. Nothing else changed: the packages stay at
   0.1.0 in the tree, the changesets guard keeps blocking the changesets lane until a bump.

## After the publish

- `arch-engine`: replace the three `file:vendor/*.tgz` specs with `^0.1.0`, drop the vendor step
  from the `refarm-proof` job and run it on every push.
- `coop-vault` / `enem`: same for the packages they consume from this unit, when they choose to.
- Record the npm evidence (`npm view @refarm.dev/quality-contract-v1 dist.integrity`) beside the
  handoff receipts, so the local packet and the registry can be compared.

## Recommended before merging (posture)

`release:promote:check` reports `mainRequiresChecks: false`. Requiring `Test & Quality` as a
status check on `main` turns "develop is green" from a habit into a rule the merge button
enforces. It is a GitHub setting only the owner can apply (ISS-071 names the same gap).
