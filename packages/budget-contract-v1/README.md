# @refarm.dev/budget-contract-v1

`budget:v1` — the three axes a dispatch may declare (`deadlineMs`, `maxTokens`,
`maxUsd`) and the resolution fold that clamps them across three nested levels.
See D9 in `docs/superpowers/specs/2026-08-03-budget-laboratory-design.md`.

## The model

Outward to inward: the **node** bounds what the machine can serve at all, the
**workspace** bounds what it may consume within that, and the **dispatch**
declares within both — Kubernetes' ResourceQuota/LimitRange split, without the
YAML.

```ts
import { resolveBudget } from "@refarm.dev/budget-contract-v1";

const node = {
	ceiling: { deadlineMs: 600_000, maxTokens: 500_000, maxUsd: 10 },
	default: { deadlineMs: 45_000, maxTokens: 100_000, maxUsd: 1 },
};

resolveBudget({ node, declared: { deadlineMs: 300_000 } });
// → deadlineMs: { effective: 300_000, declared: 300_000, boundBy: "declared" }

resolveBudget({
	node,
	workspace: { ceiling: { deadlineMs: 120_000 } },
	declared: { deadlineMs: 300_000 },
});
// → deadlineMs: { effective: 120_000, declared: 300_000, boundBy: "workspace" }
```

A workspace ceiling **above** the node's is clamped, not obeyed — a workspace
cannot grant capacity the machine lacks. `boundBy` always names the level that
actually decided the effective value, so "it was cut" never leaves the operator
to guess which ceiling to raise.

## Safety invariants

- Every axis in `node.ceiling` and `node.default` is required — the node is the
  machine, and it always knows what it can serve. A workspace may declare
  either, both, or neither, and may specify only some axes.
- Everything is PURE (no I/O, no filesystem, no config parsing) — `resolveBudget`
  is a plain function of its input. A Rust or WASM mirror implements the same
  rules this TS reference does; `runBudgetConformance` runs the shared check
  list (`BUDGET_CONFORMANCE_CHECKS`) against either.
- `resolveAxis`, the internal fold, is written generically (node/scope/request)
  on purpose — budget is its first consumer, and a later per-workspace policy
  (e.g. auth) is expected to resolve through the same three levels.
