# Ecosystem Supply Map — Refarm as Supplier

> Status: working map (2026-06-24). Consolidates the direction that Refarm supplies
> the blocks the ecosystem keeps re-implementing (npm + crates), and consumers
> (`vault-seed`, `agents-lab`) compose product from them. Complements and is governed
> by the 2026-06-24 amendment in [`VAULT_SEED_CONVERGENCE.md`](./VAULT_SEED_CONVERGENCE.md).

## Principle: Refarm's first consumer is Refarm

A block counts as *supplyable* only after Refarm itself consumes it in its own surfaces
(`apps/me`, `apps/refarm`, `farmhand`, `tractor`). Dogfooding is the readiness gate — not
the intent to publish. This protects against publishing an interface before its
implementation is proven, which is the pattern already recorded in
`packages/DISTRIBUTION_STATUS.md` (contract published early, implementation kept private
3–6 months to mature).

Corollary (accepted critique): if effort flows into `apps/refarm` in a way that accretes
logic that *should* be a reusable block (`ds`, `homestead`, `dispatch-surface`, contracts),
that is misfocus. `apps/refarm` and `apps/me` should be **thin consumers** that *prove* the
blocks. The audit has been completed in [`APPS_REFARM_PROMOTION_LEDGER.md`](./APPS_REFARM_PROMOTION_LEDGER.md):
the current work is not a broad extraction, but making existing blocks consumable and growing the
small missing surfaces called out in the convergence roadmap.

## Dual keystone

1. **Librarian in Refarm** — a checkout/cache capability for remote repositories (today it
   lives only in `agents-lab` `git-skills/git-checkout-cache`). It unblocks Refarm
   inspecting `vault-seed` and `agents-lab` read-only to absorb their logic. Already aligned
   with the existing doctrine: *"Let Refarm inspect vault-seed as an external consumer
   through read-only templates."* The base contract is specified in
   `specs/features/2026-06-24-source-contract-v1.md`; deferred adapters are activated through
   `specs/features/2026-06-25-source-adapter-activation.md`.
2. **UI boundary amendment** — see the 2026-06-24 amendment in `VAULT_SEED_CONVERGENCE.md`.
   It revokes "no UI supply" and establishes: *Refarm supplies UI / surface /
   WASM-distribution blocks; the consumer composes product.*

## Supply map (v2)

| Layer | What downstream re-implements | Refarm supplier (exists?) | Verdict / gate |
| --- | --- | --- | --- |
| **Librarian (checkout/cache)** | `agents-lab` `git-skills` | `source:v1` + `source-git` specified | KEYSTONE. Execute the source contract plan, then activate adapters only when consumed. |
| UI blocks / style | `vault-seed` astro-plugins, lab UI | `@refarm.dev/ds` ✅ | Wire `ds` as the token/style source. |
| Shell / admin UI | `dgk serve` | `@refarm.dev/homestead` ✅ + `apps/me` | Admin UI composed from `homestead`, not reinvented. |
| Multi-surface (cli/tui/web/rpc/http/a2a) | each ad hoc | `@refarm.dev/dispatch-surface` ✅ + `terminal-plugin` ✅ | One surface substrate. |
| WASM distribution (lab/site) | Marimo (Pyodide) + Astro isolated | Tractor WASM (ADR-049 / ADR-044) ✅ substrate | Refarm learns from Marimo / Astro 7 and becomes the shared substrate. |
| "Gardening" skills | `dgk-skills` | Refarm gardening/"dgk" skill set (superset) | `dgk-skills` ⊂ Refarm skills; find the overlap. |
| `dgk` operations | `dgk-cli` / `dgk-runner` | `@refarm.dev/cli/launch-process` ✅ (already the seam) | `dgk` delegates via runner adapter when Refarm is present. |
| Secrets | `silo.js` | `@refarm.dev/silo` (early design) | `silo` owns model/runtime credentials + scoped publishing adapter. |
| Channels | `dgk-channels` | `@refarm.dev/contacts` + `@refarm.dev/rate-limiter` (intent; doc-confirmed) | Bridge until the contract is consumer-neutral. |

What stays at the consumer edge is **product/content/config** (PARA vocabulary, onboarding
copy, vault-specific dataset names, editorial workflow) — not the UI capability itself.

## Migration order

1. **Librarian in Refarm** (keystone) — unblocks absorbing the rest.
2. **npm scope closed**: ADR-069 sets `@refarm.dev` as the canonical scope for Refarm blocks and
   contracts. `@aretw0/*` remains only for `vault-seed`/DGK products.
3. `ds` / `homestead` / `dispatch-surface` as the official source of UI/surface blocks.
4. WASM substrate (Tractor, ADR-049 / ADR-044) as the common distribution layer for lab/site
   surfaces — learn from Marimo (Pyodide) and Astro 7 (Rust toolchain) without embedding
   either app.
5. `silo` → credentials; `contacts` + `rate-limiter` → `dgk-channels`;
   `cli/launch-process` → `dgk-runner`. Promote only when the contract is consumer-neutral
   (existing doctrine rule).

## Librarian follow-up

The librarian question is no longer open-ended. The selected base path is:

- `source:v1` contract + `source-git` provider: `specs/features/2026-06-24-source-contract-v1.md`;
- execution plan: `docs/superpowers/plans/2026-06-24-source-contract-v1.md`;
- deferred adapter activation: `specs/features/2026-06-25-source-adapter-activation.md`.

Do not re-open the port-vs-toolbox decision during implementation. Build the base contract first;
only add `source-dispatch`, `source-local`, or `source-tarball` when the activation trigger exists.
