# Convergence Execution Runbook

> Status: execution handoff (2026-06-25). Ordered steps to execute the convergence plan. Planning
> artifacts: `docs/CONVERGENCE_ROADMAP.md` (index),
> `docs/ECOSYSTEM_SUPPLY_MAP.md`, the `specs/` and `docs/superpowers/plans/` files below.

## Before you start

- Run `pnpm` / `turbo` / `git` as usual. Commits land on the working branch.
- **Branching:** topic branch off `develop`, one per sub-project. **Conventional commits.**
  **Rebase** onto `develop` to integrate — never `merge --no-ff`.
- Consumer-proof gates require the consumer checkout. If it is not visible from the current working
  environment, produce the package artifact and a handoff instead of weakening the gate.
- For `vault-seed`-pulled blocks, do not wait for public npm publication. Use the candidate path
  recorded in the plan: packed package, generated inventory, codemod dry-run, or explicit handoff.
  The proof must keep `vault-seed` product behavior downstream-owned.
- **Plan depth:** the **librarian** and the **item-4 family (4a, 4b, 4c, 4d)** have **bite-sized
  plans** — execute step by step. Every other item has a **task-level plan + a code-rich spec**; at pickup, invoke
  `superpowers:writing-plans` on its spec to expand the bite-sized plan, then execute. See
  `docs/CONVERGENCE_FACTORY_READINESS.md` → "Plan depth". "Plan: …" below names the spec/task plan,
  not a line-by-line file (except the two bite-sized ones).
- Read `docs/CONVERGENCE_ROADMAP.md` first; each step below points at its spec/plan and its
  verification gate (smoke + intermediate checks + final gate).

## Sequence

### 0. Orient
```bash
git checkout develop && git pull --rebase
```
Skim `docs/CONVERGENCE_ROADMAP.md` and `docs/ECOSYSTEM_SUPPLY_MAP.md`.

### 1. Librarian `source:v1` — keystone, has a bite-sized plan
Branch: `feat/source-contract-v1`.
Plan: `docs/superpowers/plans/2026-06-24-source-contract-v1.md` (5 tasks, TDD).
Invoke **`superpowers:subagent-driven-development`** with that plan (fresh subagent per task, review
between). Inline execution via
`superpowers:executing-plans` is the alternative.
**Gate:** `pnpm run test:capabilities` green (now includes `source-contract-v1` + `source-git`);
`pnpm run source:librarian:smoke` prints OK.
**Why first:** after this, Refarm can materialize `vault-seed`/`agents-lab` read-only — the manual
"cola" of the planning session becomes automated.

### 2. ADR-069 npm-scope doc sweep — done
Spec: `specs/features/2026-06-25-npm-scope-doc-sweep.md`.
Plan: `docs/superpowers/plans/2026-06-25-npm-scope-doc-sweep.md`.
**Gate:** no Refarm publish target names `@aretw0`; package manifests already correct (verified).
**Status:** complete. Remaining `@aretw0` references are historical context, ADR text, or
`vault-seed`/DGK product scope references.

### 3. Item 4a — `ds` token contract
Branch: `feat/ds-token-contract`. Spec: `specs/features/2026-06-25-ds-token-contract.md`.
Plan: `docs/superpowers/plans/2026-06-25-ds-token-contract.md`.
**Gate (spec §5):** `pnpm -C packages/ds run test` (all 4 themes conform; incomplete theme reports
`missing`); scope-leak check (host `:root` unaffected); `vault-seed` consumer proof on a branch.

### 4. Item 4b — `homestead` build-free SSR tier (depends on 4a)
Branch: `feat/homestead-ssr-tier`. Spec: `specs/features/2026-06-25-homestead-ssr-tier.md`.
Plan: `docs/superpowers/plans/2026-06-25-homestead-ssr-tier.md`.
**Gate:** tier unit tests run under plain `node` (build-free); isolation check (no `./sdk` import);
a11y check; `vault-seed` `serve.js` rebuilt on the tier, `docs/roteiro-teste-admin.md` passes.

### 5. Item 4c — silo collection contract
Branch: `feat/silo-collection-contract`. Spec: `specs/features/2026-06-25-silo-collection-contract.md`.
Plan: `docs/superpowers/plans/2026-06-25-silo-collection-contract.md`.
**Gate:** `collect.test` (namespaced, no collision); `apps/refarm` credential providers conform;
acyclic `silo → prompt-contract-v1`; `pnpm -C packages/silo run lint && type-check && test`.

### 6. Consumer-pulled bridge proofs
These are not broad bridge projects. They exist to stop `vault-seed` from maintaining local
versions of Refarm-shaped blocks.

- **8a after item 4c:** write the focused bridge spec for `vault-seed` `silo.js` ->
  `@refarm.dev/silo`; prove namespaces remain `model`, `runtime`, `channel`, and `publishing`.
- **8c candidate:** prove `dgk-runner` can delegate to or emit the same
  `@refarm.dev/cli/launch-process` + artifact provenance envelope without importing `dgk`
  vocabulary into Refarm.
- **8b candidate:** write the focused channel-policy bridge spec using `vault-seed` Telegram
  outbox/inbox as a fixture and Refarm `dispatch-surface`/Farmhand channel-control as the second
  consumer. Keep Telegram API calls, Markdown formatting, note filenames, and `dgk` UX downstream.

**Gate:** each activated bridge has its own spec, package/API decision, consumer proof, fallback,
and rollback note.

### 7. Item 5 — ADR-070 follow-ups
- **Part B (commit):** reconcile ADR-049 wording to **native-first + WASM-fallback** for Tractor
  distribution (doc change; keep dual-runtime).
- **Part C (speculative):** follow `docs/superpowers/plans/2026-06-25-astro-wasi-ssr-poc.md`.
  Green → write a Part C feature spec. Red → drop Part C, record the blocker.

### 8. Item 4d — dispatch-surface external API
Branch: `feat/dispatch-surface-external-api`.
Spec: `specs/features/2026-06-25-dispatch-surface-external-api.md`.
Plan: `docs/superpowers/plans/2026-06-25-dispatch-surface-external-api.md`.
**Gate:** package-root public API lock test; consumer-style fixture with no deep imports;
`pnpm --filter @refarm.dev/dispatch-surface run test`; `test:parity`; `type-check`.

### 9. Item 9a — generator-first vault-seed distribution
Branch: `feat/vault-seed-generator-contract`.
Spec: `specs/features/2026-06-25-vault-seed-generator-contract.md`.
Plan: `docs/superpowers/plans/2026-06-25-vault-seed-generator-contract.md`.
**Gate:** manifest distinguishes payload/dev-only files; generated output has inventory report;
selected `vault-seed` generated-vault smoke passes.

### 10. Item 9b — codemod registry contract
Branch: `feat/codemod-registry-contract`.
Spec: `specs/features/2026-06-25-codemod-registry-contract.md`.
Plan: `docs/superpowers/plans/2026-06-25-codemod-registry-contract.md`.
**Gate:** registry validates; ready entries have fixtures, dry-run command, verification gate, and
rollback note.

### 11. Downstream assimilation review
Before adding more `vault-seed`-local substrate, classify the change:

- artifact/provenance or Lab manifest -> attach to artifact contract proof;
- source IaC, extraction profiles, cache/staging, and data lifecycle -> attach to `source:v1`,
  artifact/provenance, and storage/retention policy;
- `target: "auto"` placement -> attach to a model/task classification contract with replayable
  artifact evidence;
- multi-channel publishing, including Mastodon, Bluesky, Instagram, newsletter, Telegram, and
  Nostr -> attach to 8b channel policy plus `silo` identity namespaces;
- generated-vault/template mechanics -> attach to item 9a/9b;
- package release/readiness checks, `dgk publish workspace`, custom distributions, and
  changelog-as-content -> attach to `release-engine`/package acceptance;
- Lab WASM helpers, feed/OpenGraph readers, and refresh jobs -> attach to item 5 WASM substrate
  plus source HTTP readers and artifact snapshots;
- OKF/JSON-LD/semantic graph export -> hold until a second consumer proves a neutral
  content/knowledge manifest;
- action pins/substrate/devcontainer/generated-output hygiene -> attach to health/environment;
- text scoring -> attach to text-quality;
- Astro/Obsidian/PARA UX -> keep downstream unless a second consumer repeats it.

**Gate:** update `docs/CONVERGENCE_FACTORY_READINESS.md` rather than adding an untracked
`vault-seed` responsibility.

### 12. Item 10 — Linux async I/O (`io_uring`) substrate POC
Branch: `research/io-uring-substrate`.
Spec: `specs/features/2026-06-25-io-uring-substrate.md`.
Plan: `docs/superpowers/plans/2026-06-25-io-uring-substrate.md`.
**Gate:** capability probe reports availability/block/unsupported; baseline and `io_uring`
implementations produce identical output; benchmark evidence shows ROI or records deferral.

### 13. Item 11 — XR/WebXR surface POC
Branch: `research/xr-surface-poc`.
Spec: `specs/features/2026-06-25-xr-surface-poc.md`.
Plan: `docs/superpowers/plans/2026-06-25-xr-surface-poc.md`.
**Gate:** 2D fallback and XR path consume the same JSON envelope; WebXR capability probe reports
supported/unsupported/blocked; XR dependencies stay inside the POC.

## Deferred — do NOT start (gated)
- **Item 6 skill contract** — wait for the "Refarm as engine" runtime (dogfooding gate). Taxonomy
  is in `docs/GARDENING_SKILLS_TAXONOMY.md`; activation packet:
  `specs/features/2026-06-25-skill-runtime-activation.md`.
- **Item 7** — `source-dispatch` adapter + `source-local` — when an agentic consumer/kernel needs them.
  Activation packet: `specs/features/2026-06-25-source-adapter-activation.md`.
- No broad Item 8 bridge remains deferred as a bucket. 8a, 8b, and 8c each require their own
  focused spec and proof before code moves.

## Per-step discipline
- TDD as written in each plan (red → green → commit).
- Verification gate **before** each commit; evidence before "done".
- Topic branch, conventional commits, rebase onto `develop`.
- **`pnpm run workspace:source:ownership`** must pass — tracked source under `packages/*/src`,
  `apps/*/src`, `scripts/`, `validations/*/src` must be owned by the running user. (Docs under
  `docs/` / `specs/` are exempt.)
