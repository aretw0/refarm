# Promote develop→main — a durable safety rite

> 2026-07-25. Answers the operator's ask: "can we update main from develop following the expected
> rites, without accidentally publishing? — and make it a durable check, not ad-hoc, that also looks
> at GitHub variables." Grounded in a full map of the release machinery (see
> `docs/2026-07-25-v0.1.0-release-readiness.md` and the investigation notes below).

## The safety model (what actually protects a promotion)

A merge/PR of `develop`→`main` auto-runs exactly one publish-capable workflow: **`release-changesets.yml`**
(`on: push: branches: [main]`). The two direct-registry publishers (`publish-packages.yml` npm,
`publish-crates.yml` crates) fire only on **version tags**, which a branch merge does not create;
`first-publish-selection.yml` is **manual** (`workflow_dispatch` + typed `confirm`, `dry_run` defaults
true). So the whole risk reduces to `release-changesets`.

Inside it, `changeset publish` (with `NPM_TOKEN`) runs only `if steps.first-publish-guard.outputs.blocked
!= 'true'`. The guard (`scripts/ci/check-first-publish-changesets.mjs`) sets `blocked=true` whenever any
pending changeset targets a package still at `0.1.0`. **That single guard is load-bearing**, because:

- `RELEASE_AUTOMATION=true` and `RELEASE_OWNER=aretw0` are already set (repo variables), so the
  job-level opt-in gate on every publish workflow is *satisfied* — it does not block.
- `NPM_TOKEN` and `CARGO_REGISTRY_TOKEN` are present and live.

So nothing missing (no token, no opt-in) protects us — only the guard does. Today it holds: all 111
workspace packages are at `0.1.0` with pending changesets, so `blocked=true` and the whole
`changeset version`+`publish` step is skipped. The risk becomes real the day a package is bumped off
`0.1.0` while pending changesets exist — then those non-`0.1.0` changesets would publish on the next
main push. That is the *expected* post-first-publish flow, but it must be *seen*, never accidental.

## The intended rite (git flow)

`main` is the release baseline (`.changeset/config.json` `baseBranch: main`). Work happens on
`develop`; promotion is a **PR develop→main**, gated pre-merge by `clean-room-verify.yml` (cache-cold
`pull_request: [main]` — the antidote to turbo-cache-masked green) and `validate-changeset.yml`. After
merge, `sync-develop.yml` fast-forwards `develop` back to `main` (or stops and opens an issue on
divergence). So: develop (work) → PR to main (gated) → main (release surface) → auto-sync back.

## The durable check: `pnpm run release:promote:check`

A new `scripts/ci/promote-check.mjs` (the `release:*` script family's convention — like
`release:readiness`, `release:boundary:audit`, and the guard itself). **Not** a `refarm release`
TS subcommand: that would either import the guard's `.mjs` chain from TS (fragile) or shell out to
`pnpm`, which violates the same process-execution boundary that
`apps/refarm/test/architecture/process-boundary.test.ts` enforces. The script is the operator-facing,
testable, architecture-clean surface.

It composes existing importable functions and emits a JSON verdict + operator handoff (`ok`,
`nextCommand`, `nextCommands`), plus a human summary. Checks:

**Publish-safety (local, deterministic):**
1. **Guard** — `findFirstPublishChangesetRisks` + `findOutOfSelectionBaselineRisks`
   (`--selection vault-seed-ready`) → the real `blocked` value the CI uses. `blocked=true` ⇒ the
   changesets publish step is skipped entirely ⇒ nothing publishes.
2. **Would-publish set** — `parseChangesets` × `readWorkspacePackageVersions`: any pending changeset
   whose target package is **not** at `0.1.0` would publish once the guard stops blocking. Listed
   explicitly so a real publish is never a surprise.

**GitHub posture (via `gh`, graceful-degrade if unauth/offline):**
3. `RELEASE_AUTOMATION` / `RELEASE_OWNER` variables (is automation armed? ⇒ guard is load-bearing).
4. `NPM_TOKEN` / `CARGO_REGISTRY_TOKEN` presence (confirms the guard is the only barrier).
5. `main` branch protection / rulesets — are the promotion gates (`clean-room-verify`, `Test &
   Quality`) required and is a PR required? A finding when weak.
6. Latest `Test & Quality` status on `develop` (is the source green?).

**Branch divergence (local git):**
7. Is the promotion a clean fast-forward, or have `main` and `develop` diverged? `main` ahead of
   `develop` at all ⇒ a naive merge/squash would conflict or drop `main`-only work ⇒ not a routine
   promotion. (This dimension was added after the first run: the branches diverged on 2026-03-06 and
   `main` carries 1372 commits / 54 files `develop` lacks — publish-safety alone would have wrongly
   reported "go".)

**Verdict:** `SAFE` (nothing would publish / held), `WOULD-PUBLISH` (list — confirm intent),
`DIVERGED` (base not an ancestor — reconcile first), or `BLOCKED` (source red). Exit non-zero for
`DIVERGED`, `BLOCKED`, or an unconfirmed `WOULD-PUBLISH`; plain `SAFE` exits 0.

> **Current real state (2026-07-25): `DIVERGED`.** Publish-safety is fine (guard blocks), but `main`
> and `develop` have diverged for ~4.5 months into parallel codebases (2558 files differ; much is the
> `pi-agent`→`agent` rename, but there is genuine parallel evolution + `main`-only commands like
> `extension.ts`). A naive `develop→main` merge is unsafe. Promotion needs a deliberate reconciliation
> — a dedicated effort, not covered here.

**Durability:** wired as `release:promote:check` in root `package.json`; a `node --test`
regression test (`scripts/ci/test-promote-check.mjs`) pins the verdict logic over fixtures (all-0.1.0
→ SAFE; a bumped package with a changeset → WOULD-PUBLISH; empty → SAFE).

## Enforcement (the one outward change — operator-applied)

`main` is the default branch; the active "default" ruleset covers only deletion/non-fast-forward.
There is no PR-required or required-checks gate, so a raw `git push origin main` bypasses
clean-room-verify + Test & Quality. To *enforce* the rite, add a second ruleset requiring a **pull
request** (0 approvals — solo-friendly) on the default branch:

```bash
gh api --method POST repos/aretw0/refarm/rulesets --input - <<'JSON'
{ "name": "promote-gate", "target": "branch", "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [ { "type": "pull_request", "parameters": {
    "required_approving_review_count": 0, "dismiss_stale_reviews_on_push": false,
    "require_code_owner_review": false, "require_last_push_approval": false,
    "required_review_thread_resolution": false,
    "allowed_merge_methods": ["merge", "squash", "rebase"] } } ] }
JSON
```

This is intentionally **operator-applied**, not auto-applied by an agent: modifying repo protection is
an outward settings change that deserves a human at the trigger (the sandbox's safety classifier
enforces exactly this). Fully reversible: `gh api --method DELETE repos/aretw0/refarm/rulesets/<id>`.

**Required status checks are deliberately NOT added here.** Test & Quality reports per *job*
(`quality`, `summary`, `e2e`, …) and several jobs are conditionally skipped by change-detection; a
`skipped` conclusion on a required check is treated as passing by GitHub, so requiring those contexts
would either be a false pass or wedge PRs "waiting" for a check that never reports. Requiring the PR is
the reliable structural gate; the quality/clean-room checks still run on every promotion PR, and
`release:promote:check` surfaces whether they were green. A robust required-checks setup needs a single
always-reporting aggregate check observed on a real PR first — tracked as a follow-up.

## Out of scope

Not touching the publish workflows themselves (their guards are already covered by
`scripts/ci/test-deploy-publish-workflows.mjs`). Not changing the HELD posture or versions.
