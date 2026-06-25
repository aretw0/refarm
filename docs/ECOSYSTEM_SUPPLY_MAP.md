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
blocks. **[VERIFY: audit `apps/refarm` — does it concentrate promotable logic?]** This is
flagged, not asserted; the internals have not been audited yet.

## Dual keystone

1. **Librarian in Refarm** — a checkout/cache capability for remote repositories (today it
   lives only in `agents-lab` `git-skills/git-checkout-cache`). It unblocks Refarm
   inspecting `vault-seed` and `agents-lab` read-only to absorb their logic. Already aligned
   with the existing doctrine: *"Let Refarm inspect vault-seed as an external consumer
   through read-only templates."* See open questions below.
2. **UI boundary amendment** — see the 2026-06-24 amendment in `VAULT_SEED_CONVERGENCE.md`.
   It revokes "no UI supply" and establishes: *Refarm supplies UI / surface /
   WASM-distribution blocks; the consumer composes product.*

## Supply map (v2)

| Layer | What downstream re-implements | Refarm supplier (exists?) | Verdict / gate |
| --- | --- | --- | --- |
| **Librarian (checkout/cache)** | `agents-lab` `git-skills` | `agent-tools` / `toolbox` — **absent** | KEYSTONE. Build it. Doctrine already wants read-only consumer inspection. |
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
2. **Close the npm scope**: `@aretw0` (contracts in `DISTRIBUTION_STATUS`) vs `@refarm.dev`
   (`ds`/`homestead`/...). Currently inconsistent; a precondition for any downstream import.
3. `ds` / `homestead` / `dispatch-surface` as the official source of UI/surface blocks.
4. WASM substrate (Tractor, ADR-049 / ADR-044) as the common distribution layer for lab/site
   surfaces — learn from Marimo (Pyodide) and Astro 7 (Rust toolchain) without embedding
   either app.
5. `silo` → credentials; `contacts` + `rate-limiter` → `dgk-channels`;
   `cli/launch-process` → `dgk-runner`. Promote only when the contract is consumer-neutral
   (existing doctrine rule).

## Next sub-project: librarian spec (open questions)

- **Form in Refarm**: a `checkout:v1` contract (third parties implement) vs an internal
  `agent-tool` / `toolbox` (only Refarm's own agent uses it)?
- **Implementation**: port `checkout.sh` (bash), or grow it in Rust (`tractor`) / TS so it
  runs cross-surface?
- **Cache**: reuse `~/.cache/checkouts/<host>/<org>/<repo>` + partial clone
  (`--filter=blob:none`) from the `agents-lab` version?
