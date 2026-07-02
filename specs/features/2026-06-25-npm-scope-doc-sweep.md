# Spec: ADR-069 npm Scope Documentation Sweep

**Status:** DRAFT — mechanical docs sweep
**Authors:** Arthur Silva
**Date:** 2026-06-25
**Related:** `specs/ADRs/ADR-069-npm-scope-canonicalization.md`, `docs/CONVERGENCE_ROADMAP.md` item 3

---

## Context & Motivation

ADR-069 accepted `@refarm.dev/*` as the canonical npm scope for Refarm blocks. The code already
uses that scope, but old publishing docs still describe Refarm contracts under `@aretw0/*`.
That mismatch can make a release operator stop to re-decide scope even though the decision is
closed.

## Decision

Perform a reviewed, mechanical documentation sweep:

- change Refarm block/contract publish targets from `@aretw0/*` to `@refarm.dev/*`;
- keep legitimate `@aretw0/*` references for `vault-seed` / `dgk` products;
- keep historical ADR text when it explains the inconsistency, but point readers to ADR-069 as the
  accepted decision.

## Candidate Files

Review at least:

- `packages/DISTRIBUTION_STATUS.md`;
- `docs/v0.1.0-release-gate.md`;
- `docs/REFARM_PERSONAL_DAILY_DRIVER.md`;
- `docs/REPOSITORY_MIGRATION_GUIDE.md`;
- `docs/POST_TRANSFER_CHECKLIST.md`;
- `docs/PRE_MIGRATION_CLEANUP_CHECKLIST.md`;
- `docs/USER_STORY.md`;
- `docs/EXTENSIBILITY_MODEL.md`;
- convergence docs that mention the old inconsistency.

## Verification

1. `rg "@aretw0" docs packages specs apps .changeset` has no Refarm block publish target under
   `@aretw0`.
2. Remaining `@aretw0` hits are either `dgk` product references, historical ADR context, or owner
   handles.
3. `git diff --check` passes.

## Codemod Discipline

Use a reviewed replace list, not a blind global replacement. This is a codemod-shaped sweep, but
the allowlist matters because `@aretw0/dgk-*` is still correct.
