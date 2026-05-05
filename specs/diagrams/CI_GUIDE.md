# CI Pipeline Guide

> Focused sub-views of the full CI pipeline. Each section explains one stage.
>
> **Full diagram**: [`ci-pipeline.svg`](./ci-pipeline.svg) —
> **Index**: [`INDEX.md`](./INDEX.md)

---

## Complete View

<!-- {=ci-full} -->
**Source**: [`ci-pipeline.mermaid`](./ci-pipeline.mermaid)

![Full CI Pipeline](./ci-pipeline.svg)
<!-- {/ci-full} -->

---

## Stage 1 — Change Detection

Every run starts by computing exactly what changed and which jobs need to run.

<!-- {=ci-changes} -->
**Source**: [`ci-pipeline--changes.mermaid`](./ci-pipeline--changes.mermaid)

![CI change detection](./ci-pipeline--changes.svg)

> Smart change detection: every push/PR computes a `turbo_filter` (`...[base_sha]`)
> and a set of boolean flags that gate each downstream job.
> Only affected packages are tested — unaffected packages use Turborepo cache.
<!-- {/ci-changes} -->

| Flag | Trigger paths | Downstream |
|---|---|---|
| `code_changes` | `apps/ packages/ scripts/` | quality · build · audit |
| `tractor_gates` | `tractor* barn storage-sqlite sync-loro` | tractor specialized gates |
| `run_task_smoke` | `farmhand refarm effort pi-agent` | CLI ↔ sidecar smoke |
| `run_e2e` | `apps/ validations/ tractor*` | Playwright E2E |
| `run_deep` | weekly schedule or `ci:deep` PR label | full regression |

The `changes` job also computes content signatures for expensive validation results. A signature includes the validation name/version context, the selected tracked file paths, and the selected file contents. If a previous successful marker exists for the same signature, the downstream gate can reuse it; otherwise the gate runs fresh.

---

## Stage 2 — Quality Job

The main enforcement gate. Runs on every code change.

<!-- {=ci-quality} -->
**Source**: [`ci-pipeline--quality.mermaid`](./ci-pipeline--quality.mermaid)

![CI quality gates](./ci-pipeline--quality.svg)

> The `quality` job is the main enforcement layer. It runs project consistency checks,
> security audit, TypeScript preflight, and task smoke tests on every code change.
> When Tractor packages are affected, an additional set of specialized gates runs:
> health probe, runtime descriptor, revocation diagnostics, benchmark, and coverage.
<!-- {/ci-quality} -->

On cache hit, `quality` still runs `.project` cross-block validation, then skips the expensive quality stack with an explicit GitHub Actions notice. On cache miss, it runs fresh and records the marker only after success.

**Tractor gates** only run when `tractor_gates=true` (Tractor, Barn, storage-sqlite, or sync-loro changed):

| Gate | Purpose |
|---|---|
| Health probe smoke | Boots `@refarm.dev/tractor-rs` and verifies health endpoint |
| Runtime-module:ci | Validates browser runtime descriptor is deterministic |
| Release-path smoke | Verifies descriptor survives the publish pipeline |
| Revocation diagnostics | Report + baseline diff + history trend |
| Benchmark gate | Compares bench vs main baseline; comments PR on new high-water mark |
| Coverage gate | Enforces coverage baseline; comments PR on new high score |

---

## Stage 3 — Granular Matrix Tests

`Granular Matrix Tests` is separate from `Test & Quality`. Its responsibility is package compatibility, not monorepo health.

| Job | Responsibility |
|---|---|
| `Matrix Discovery` | Computes the package compatibility DAG and the `granular-matrix` content signature. |
| Dynamic matrix jobs | Run forward/backward local-vs-published compatibility scenarios only when the signature is fresh. |
| `Matrix Cache Finalize` | Records a successful marker only after the dynamic matrix succeeds or is legitimately empty/skipped. |

On cache hit, `Matrix Discovery` emits an explicit reuse notice and returns an empty matrix (`{"include":[]}`), so the expensive dynamic matrix jobs are skipped while the workflow still succeeds.

---

## Stage 4 — Phase Gates (SDD → BDD → TDD → DDD)

Label-driven gates that enforce the sovereign development methodology.

<!-- {=ci-phase-gates} -->
**Source**: [`ci-pipeline--phase-gates.mermaid`](./ci-pipeline--phase-gates.mermaid)

![CI phase gates](./ci-pipeline--phase-gates.svg)

> Each PR may carry a `phase:sdd/bdd/tdd/ddd` label that triggers the matching gate.
> Gates enforce the **SDD→BDD→TDD→DDD** methodology at the CI level:
> specs must be clean before tests go red, tests must be red before code is written,
> and a changeset must exist before a DDD PR can merge.
> A PR with no phase label passes this workflow with a notice; phase gates express development intent, not general repository health.
<!-- {/ci-phase-gates} -->

| Label | Gate | Requirement |
|---|---|---|
| `phase:sdd` | SDD gate | `specs/` changed · no TODO/TBD |
| `phase:bdd` | BDD gate | Integration tests must **FAIL** (red phase) |
| `phase:tdd` | TDD gate | Unit tests + coverage ≥80% |
| `phase:ddd` | DDD gate | All tests green + `.changeset/*.md` present |

See [WORKFLOW.md](../WORKFLOW.md) for the full SDD→BDD→TDD→DDD process narrative.

---

## Regeneration

```bash
# from project root
npm run diagrams:check

# from specs/diagrams/
mdt update   # sync template blocks → this file
mdt check    # verify no drift (runs in CI)
```
