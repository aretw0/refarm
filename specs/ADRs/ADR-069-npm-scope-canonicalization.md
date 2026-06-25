# ADR-069: npm Scope Canonicalization

**Status**: Accepted
**Date**: 2026-06-25
**Authors**: Arthur Silva
**Related**: `docs/CONVERGENCE_ROADMAP.md` (item 3), `docs/ECOSYSTEM_SUPPLY_MAP.md`, `packages/DISTRIBUTION_STATUS.md`

---

## Context

For the ecosystem to consume Refarm blocks (`import { Shell } from "@…/homestead"`), the npm
scope must be settled. Two scopes were in play and the docs disagreed with the code:

- `packages/DISTRIBUTION_STATUS.md` plans to publish the foundational contracts as
  `@aretw0/storage-contract-v1`, etc.
- Every actual `package.json` already uses `@refarm.dev/*`.

Ground truth (verified 2026-06-25):

- **Reserved by the owner on npm:** `@refarm.dev`, `@refarm.me`, `@refarm.social`.
- The bare `@refarm` scope is **not** owned — this is why some intent leaked to `@aretw0`
  (the personal scope, already home to the published `dgk` product packages).
- Package names in this repo: **60 `@refarm.dev` + 2 `@refarm.me`** (`apps/me`). **Zero `@aretw0`.**
- npm publish state: **no Refarm package is published in any scope**; only `vault-seed` products
  are live — `@aretw0/dgk-cli@0.2.1`, `@aretw0/dgk-skills@0.1.0`.

So there is no publish debt to unwind. The `@aretw0` contract plan was never executed. This ADR
ratifies what the code already does and corrects the docs.

## Decision

Canonical scope assignment:

| Scope | Owns | Notes |
|---|---|---|
| `@refarm.dev/*` | All Refarm blocks, contracts, and SDK — **the supply surface the ecosystem consumes** | Already the code state (60 packages). The canonical scope. |
| `@refarm.me/*` | The personal hub app(s) | `apps/me` is `@refarm.me/app`. User-facing product, not a block. |
| `@refarm.social/*` | Social / Nostr layer | Reserved; future. |
| `@aretw0/*` | `vault-seed` product packages (`dgk-*`) | Consumer products in the owner's personal scope; **not** Refarm blocks. Stay as-is and consume `@refarm.dev/*`. |
| `@refarm` (bare) | — | **Not owned. Never use.** |

The rule: anything the ecosystem imports as a shared block publishes under `@refarm.dev`. Product
surfaces publish under their product scope (`@refarm.me` for the hub, `@aretw0` for `dgk`).

## Consequences

### Positive
- `vault-seed` can depend on `@refarm.dev/*` blocks once published. Unblocks roadmap item 4.
- No npm cleanup, no rename of code: the code already matches the decision.

### Migration (docs only — no code change)
Correct every doc that names `@aretw0` as Refarm's publish scope to `@refarm.dev`. Verify each
hit in context first — some `@aretw0` references legitimately describe `vault-seed`'s `dgk`
products and must stay. Files to review:

- [x] `packages/DISTRIBUTION_STATUS.md` — change the three contract publish targets and tag commands from `@aretw0/*` to `@refarm.dev/*`.
- [x] `docs/v0.1.0-release-gate.md`
- [x] `docs/REFARM_PERSONAL_DAILY_DRIVER.md`
- [x] `docs/REPOSITORY_MIGRATION_GUIDE.md`, `docs/POST_TRANSFER_CHECKLIST.md`, `docs/PRE_MIGRATION_CLEANUP_CHECKLIST.md`
- [x] `docs/USER_STORY.md`, `docs/EXTENSIBILITY_MODEL.md`

(The convergence docs — `CONVERGENCE_ROADMAP.md`, `ECOSYSTEM_SUPPLY_MAP.md`, and the source-contract plan — reference `@aretw0` only to describe this very inconsistency; update them to point at this ADR rather than editing the description away.)

### Neutral / orthogonal
- **Git owner migration** is independent of the npm scope and is currently parked. If Refarm later
  leaves `aretw0/refarm` for `refarm-dev`, Codeberg, or a self-hosted Git node, update
  `repository.url`/`homepage` fields at that time. It does not block any convergence item.
- **Timing:** because `@refarm.dev` is already the code state, there is no rename and no conflict
  with the Prêmio Serpro window (no `vault-seed` rename is involved here).

### Publishing
When the first `@refarm.dev` contracts publish: `publishConfig.access: "public"` is already set in
the package manifests; publish proceeds under `@refarm.dev` with the existing release workflow.

## References

- `docs/ECOSYSTEM_SUPPLY_MAP.md` — migration order (item 2: close npm scope)
- `packages/DISTRIBUTION_STATUS.md` — the doc this ADR corrects
- `apps/me/package.json` — `@refarm.me/app` precedent for the product-scope split
