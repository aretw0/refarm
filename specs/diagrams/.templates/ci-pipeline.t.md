<!-- mdt template — run `mdt update` from specs/diagrams/ to sync, `mdt check` in CI -->

<!-- {@ci-full} -->
**Source**: [`ci-pipeline.mermaid`](./ci-pipeline.mermaid)

![Full CI Pipeline](./ci-pipeline.svg)
<!-- {/ci-full} -->

<!-- {@ci-changes} -->
**Source**: [`ci-pipeline--changes.mermaid`](./ci-pipeline--changes.mermaid)

![CI change detection](./ci-pipeline--changes.svg)

> Smart change detection: every push/PR computes a `turbo_filter` (`...[base_sha]`)
> and a set of boolean flags that gate each downstream job.
> Only affected packages are tested — unaffected packages use Turborepo cache.
<!-- {/ci-changes} -->

<!-- {@ci-quality} -->
**Source**: [`ci-pipeline--quality.mermaid`](./ci-pipeline--quality.mermaid)

![CI quality gates](./ci-pipeline--quality.svg)

> The `quality` job is the main enforcement layer. It runs project consistency checks,
> security audit, TypeScript preflight, and task smoke tests on every code change.
> When Tractor packages are affected, an additional set of specialized gates runs:
> health probe, runtime descriptor, revocation diagnostics, benchmark, and coverage.
<!-- {/ci-quality} -->

<!-- {@ci-phase-gates} -->
**Source**: [`ci-pipeline--phase-gates.mermaid`](./ci-pipeline--phase-gates.mermaid)

![CI phase gates](./ci-pipeline--phase-gates.svg)

> Each PR carries a `phase:sdd/bdd/tdd/ddd` label that triggers the matching gate.
> Gates enforce the **SDD→BDD→TDD→DDD** methodology at the CI level:
> specs must be clean before tests go red, tests must be red before code is written,
> and a changeset must exist before a DDD PR can merge.
<!-- {/ci-phase-gates} -->
