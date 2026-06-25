# Convergence Execution Runbook

> Status: execution handoff (2026-06-25). Ordered steps to execute the convergence plan. Planning
> artifacts: `docs/CONVERGENCE_ROADMAP.md` (index),
> `docs/ECOSYSTEM_SUPPLY_MAP.md`, the `specs/` and `docs/superpowers/plans/` files below.

## Before you start

- Run `pnpm` / `turbo` / `git` as usual. Commits land on the working branch (the planning artifacts
  were committed to `docs/convergence-planning`).
- **Branching:** topic branch off `develop`, one per sub-project. **Conventional commits.**
  **Rebase** onto `develop` to integrate — never `merge --no-ff`.
- Consumer-proof gates require the consumer checkout. If it is not visible from the current working
  environment, produce the package artifact and a handoff instead of weakening the gate.
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

### 2. ADR-069 npm-scope doc sweep — quick, mechanical, unblocks publishing
Branch: `docs/npm-scope-canonicalization`.
Spec: `specs/features/2026-06-25-npm-scope-doc-sweep.md`.
Plan: `docs/superpowers/plans/2026-06-25-npm-scope-doc-sweep.md`.
**Gate:** no Refarm publish target names `@aretw0`; package manifests already correct (verified).

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

### 6. Item 5 — ADR-070 follow-ups
- **Part B (commit):** reconcile ADR-049 wording to **native-first + WASM-fallback** for Tractor
  distribution (doc change; keep dual-runtime).
- **Part C (speculative):** follow `docs/superpowers/plans/2026-06-25-astro-wasi-ssr-poc.md`.
  Green → write a Part C feature spec. Red → drop Part C, record the blocker.

### 7. Item 4d — dispatch-surface external API
Branch: `feat/dispatch-surface-external-api`.
Spec: `specs/features/2026-06-25-dispatch-surface-external-api.md`.
Plan: `docs/superpowers/plans/2026-06-25-dispatch-surface-external-api.md`.
**Gate:** package-root public API lock test; consumer-style fixture with no deep imports;
`pnpm --filter @refarm.dev/dispatch-surface run test`; `test:parity`; `type-check`.

### 8. Item 9a — generator-first vault-seed distribution
Branch: `feat/vault-seed-generator-contract`.
Spec: `specs/features/2026-06-25-vault-seed-generator-contract.md`.
Plan: `docs/superpowers/plans/2026-06-25-vault-seed-generator-contract.md`.
**Gate:** manifest distinguishes payload/dev-only files; generated output has inventory report;
selected `vault-seed` generated-vault smoke passes.

### 9. Item 9b — codemod registry contract
Branch: `feat/codemod-registry-contract`.
Spec: `specs/features/2026-06-25-codemod-registry-contract.md`.
Plan: `docs/superpowers/plans/2026-06-25-codemod-registry-contract.md`.
**Gate:** registry validates; ready entries have fixtures, dry-run command, verification gate, and
rollback note.

### 10. Item 10 — Linux async I/O (`io_uring`) substrate POC
Branch: `research/io-uring-substrate`.
Spec: `specs/features/2026-06-25-io-uring-substrate.md`.
Plan: `docs/superpowers/plans/2026-06-25-io-uring-substrate.md`.
**Gate:** capability probe reports availability/block/unsupported; baseline and `io_uring`
implementations produce identical output; benchmark evidence shows ROI or records deferral.

### 11. Item 11 — XR/WebXR surface POC
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
- **Item 8** — consumer bridges (`vault-seed` `silo.js` → `@refarm.dev/silo`; `contacts` +
  `rate-limiter`; `cli/launch-process`) — gated by a second consumer and split into one spec per
  bridge in `docs/CONVERGENCE_FACTORY_READINESS.md`. Activation packet:
  `specs/features/2026-06-25-consumer-bridges-activation.md`.

## Per-step discipline
- TDD as written in each plan (red → green → commit).
- Verification gate **before** each commit; evidence before "done".
- Topic branch, conventional commits, rebase onto `develop`.
- **`pnpm run workspace:source:ownership`** must pass — tracked source under `packages/*/src`,
  `apps/*/src`, `scripts/`, `validations/*/src` must be owned by the running user. (Docs under
  `docs/` / `specs/` are exempt.)
