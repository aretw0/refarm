# ADR-068: Artifact Contract Naming

**Status**: Accepted
**Date**: 2026-06-12
**Deciders**: Arthur Silva
**Related**: `@refarm.dev/artifact-contract-v1`, `refarm.task-artifacts.v1`, POC validation manifests

---

## Context

Refarm now has a reusable evidence contract for generated datasets, reports,
receipts, logs, audit trails, and nested manifests.

The first implementation used the spelling `artifact`. That spelling is valid,
but `artifact` is more common in developer tooling, CI systems, GitHub Actions,
build outputs, and many API ecosystems. Because the package has not been
published to npm yet, this is still a pre-release correction rather than a
public breaking change.

Naming is part of the public contract:

- npm package name: `@refarm.dev/artifact-contract-v1`
- schema value: `refarm.task-artifacts.v1`
- TypeScript names such as `TaskArtifactManifest`
- helpers such as `selectTaskArtifacts` and `findTaskArtifactById`
- generated POC manifests and validation fixtures

Silent drift between `artifact` and `artifact` would make the contract harder
for second and third consumers to understand.

---

## Decision

**Use `artifact` as the canonical spelling for the public contract before the
first package publication.**

This covers package names, schema strings, TypeScript symbols, scripts, docs,
fixtures, generated POC manifests, and consumer smoke tests.

We will not keep `artifact` aliases in the v1 surface unless a real pre-release
consumer requires a migration window. Local unpublished churn is cheaper than
publishing a confusing public API.

---

## Consequences

**Positive:**

- Aligns Refarm with common developer and CI vocabulary.
- Avoids carrying a known naming mismatch into the first npm release.
- Gives future consumers one spelling across docs, schemas, fixtures, and
  TypeScript exports.

**Negative:**

- Requires a coordinated rename across package, scripts, docs, and generated
  validation evidence.
- Existing local worktrees must update imports and fixture names.

**Risk:**

- Risk: residual `artifact` references survive in source or docs. Mitigation:
  use repository search and validation scripts as part of the rename slice.

---

## Implementation

**Affected components:**

- `packages/artifact-contract-v1`
- `validations/*/fixtures/expected/task-artifacts.json`
- `validations/poc-evidence-index.json`
- POC validation scripts and consumer smoke tests
- Docs that mention task artifact manifests

**Validation:**

1. Run package tests and build for `@refarm.dev/artifact-contract-v1`.
2. Regenerate POC fixtures.
3. Run `pnpm run task-artifacts:check`.
4. Run `pnpm run validation-pocs:test`.
5. Run the Refarm agent finish gate for the edited slice.

---

## References

- `packages/artifact-contract-v1/README.md`
- `validations/poc-evidence-index.json`
- `docs/POC_WRITING_HANDOFF.md`
