<!-- mdt template — run `mdt update` from docs/diagrams/ to sync, `mdt check` in CI -->

<!-- {@workflow-full} -->
**Source**: [`workflow-diagram.mermaid`](./workflow-diagram.mermaid)

![Full Workflow Diagram](./workflow-diagram.svg)
<!-- {/workflow-full} -->

<!-- {@workflow-sdd} -->
**Source**: [`workflow-diagram--sdd.mermaid`](./workflow-diagram--sdd.mermaid)

![SDD Phase](./workflow-diagram--sdd.svg)

> **Specification Driven Development**: Write ADRs, feature specs, and diagrams before any code.
> Gate 1 enforces no TODOs or TBDs — the spec must be complete and reviewed before moving on.
<!-- {/workflow-sdd} -->

<!-- {@workflow-bdd} -->
**Source**: [`workflow-diagram--bdd.mermaid`](./workflow-diagram--bdd.mermaid)

![BDD Phase](./workflow-diagram--bdd.svg)

> **Behavior Driven Development**: Write integration tests that capture acceptance criteria.
> Tests must be **RED** at Gate 2 — a passing test here means the behavior wasn't captured yet.
<!-- {/workflow-bdd} -->

<!-- {@workflow-tdd} -->
**Source**: [`workflow-diagram--tdd.mermaid`](./workflow-diagram--tdd.mermaid)

![TDD Phase](./workflow-diagram--tdd.svg)

> **Test Driven Development**: Write unit tests and define contracts — all must be RED.
> Gate 3 requires tests failing **and** ≥80% coverage target documented before implementation begins.
<!-- {/workflow-tdd} -->

<!-- {@workflow-ddd} -->
**Source**: [`workflow-diagram--ddd.mermaid`](./workflow-diagram--ddd.mermaid)

![DDD Phase](./workflow-diagram--ddd.svg)

> **Domain Driven Development**: Implement domain logic until all tests turn GREEN.
> Gate 4 requires all tests green, coverage met, a changeset entry, and peer review.
<!-- {/workflow-ddd} -->
