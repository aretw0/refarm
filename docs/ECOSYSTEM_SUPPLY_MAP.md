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

## Principle: Refarm is the default supplier

When `vault-seed`, `agents-lab`, or an adjacent project carries substrate that
could be a Refarm SDK block, engine primitive, package, crate, codemod, or
generator, the default target is to supply it from Refarm. Downstream projects
should keep audience, product vocabulary, local adapters, editorial choices, and
workflow composition; they should not keep private reimplementations of process
execution, artifact evidence, release policy, source materialization, dispatch
surfaces, credentials, health checks, package acceptance, or skill/runtime
contracts once a Refarm block can serve the job.

This is a powered-by posture, not a brand takeover, and it does not remove
Refarm's own products. Refarm remains its own first consumer through the
`refarm` CLI, apps, runtime-agent, Farmhand, Tractor, and operator workflows.
A user can enter through `vault-seed` and use `dgk` as a vault product that
imports Refarm blocks internally, while another user can enter through the
Refarm CLI directly. The technical standard is still strict: if the capability
is reusable, Refarm owns and publishes it; if the capability is product-specific,
the consumer composes it and fills its own labels, metadata, commands, and UX.

Consumer pull is also a readiness gate. If `vault-seed` is rebuilding a
Refarm-shaped block locally, Refarm should not wait for a public release to prove
the block. The right path is candidate consumption: Refarm dogfoods the block,
packs or exposes it through a manifest/codemod path, then `vault-seed` proves it
on a branch. The proof feeds v0.1.0 confidence without turning `vault-seed` into
a Refarm-branded distro or making Refarm a required dependency for already
generated vaults. New or maintained product packages may still be powered by
Refarm internally when that reduces duplicated substrate.

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
| **Librarian (checkout/cache)** | `agents-lab` `git-skills` | `@refarm.dev/source-contract-v1` ✅ + `@refarm.dev/source-git` ✅ + `@refarm.dev/source-local` ✅ | KEYSTONE implemented. `source-local` covers live dirty-tree reads; `source-dispatch` remains deferred until an agent/kernel path consumes it. |
| UI blocks / style | `vault-seed` astro-plugins, lab UI | `@refarm.dev/ds` ✅ + `@refarm.dev/ds/html` ✅ | Wire `ds` as the token/style source and DS-owned build-free HTML helper surface. |
| Shell / admin UI | `dgk serve` | `@refarm.dev/ds/html` ✅ | Admin UI composes from DS-owned HTML helpers; Homestead SSR package/subpath surfaces were removed pre-publication. |
| Multi-surface (cli/tui/web/rpc/http/a2a) | each ad hoc | `@refarm.dev/dispatch-surface` ✅ + `terminal-plugin` ✅ | One surface substrate. |
| WASM distribution (lab/site) | Marimo (Pyodide) + Astro isolated | Tractor WASM (ADR-049 / ADR-044) ✅ substrate | Refarm learns from Marimo / Astro 7 and becomes the shared substrate. |
| "Gardening" skills | `dgk-skills` | Refarm gardening/"dgk" skill set (superset) | `dgk-skills` ⊂ Refarm skills; find the overlap. |
| `dgk` operations | `dgk-cli` / `dgk-runner` | `@refarm.dev/process-handoff` ✅ (`@refarm.dev/cli/process-handoff` re-exports it for compatibility), artifact/channel/release/source primitives next | `dgk` is powered by Refarm where practical: imports Refarm SDK primitives internally while keeping its package, binary, command UX, audience, and product labels. |
| Secrets | `silo.js` | `@refarm.dev/silo` (early design) | `silo` owns model/runtime credentials + scoped publishing adapter. |
| Channels / outbox evidence | `dgk-channels`, Telegram outbox/inbox | `@refarm.dev/channel-policy-v1` candidate, later `contacts` + `rate-limiter` split if needed | Candidate active: Telegram remains downstream adapter; Refarm owns destination/rate-limit/receipt/dry-run/review evidence. |
| Source IaC / ETL profiles | `lab.sources.json`, `ExtractionProfile`, `.dgk/cache`, `.dgk/staging` | `source:v1` adapters + source profile contract + artifact retention policy | Candidate: Python implementations and PARA target rules stay downstream. |
| Lab runtime data helpers | WASM HTTP helpers, feed/OpenGraph readers, refresh jobs | WASM substrate + source HTTP readers + artifact snapshots | Candidate after item 5 proof; Marimo UX stays downstream. |
| Workspace publishing / generated distributions | `dgk publish workspace`, initialize reset, package provenance | generator/codemod registry + `release-engine` + package acceptance policy | Candidate active through item 9; distribution identity stays downstream. |
| Knowledge/content export | OKF mapping, JSON-LD graph, semantic graph, changelog-as-content | future knowledge/content manifest contract + release-note artifact envelope | Hold until a second consumer proves the same envelope. |
| Data lifecycle beyond git | SQLite, data repo, snapshot compaction | storage/materialization/retention policy attached to artifacts | Candidate: backend choice and migration timing stay vault-owned. |

What stays at the consumer edge is **product/content/config** (PARA vocabulary, onboarding
copy, vault-specific dataset names, editorial workflow) — not the UI capability itself.

## Migration order

1. **Librarian in Refarm** (keystone) — unblocks Refarm absorbing the rest without
   depending on manual cross-checkout memory.
2. **npm scope closed**: ADR-069 sets `@refarm.dev` as the canonical scope for Refarm blocks and
   contracts. `@aretw0/*` remains only for `vault-seed`/DGK products.
3. **Consumer-pulled block lane**: `ds`/`ds/html`, `process-handoff`,
   artifact provenance, and `silo` collect can advance in parallel with the
   librarian when their plans include Refarm dogfood + `vault-seed` proof.
4. `dispatch-surface` as the official multi-surface API once public imports and
   consumer-style fixtures are locked.
5. **Generator/codemod lane**: make `vault-seed` generation manifest-first and
   codemod-backed so boilerplate reduction is tested instead of hand-maintained.
6. **Roadmap assimilation lane**: before implementing future `vault-seed` roadmap
   substrate, classify it as source/profile, channel policy, release/generator, WASM/lab,
   storage/retention, or knowledge/content manifest pressure. Activate through the matching
   spec, not through product-local stand-ins.
7. WASM substrate (Tractor, ADR-049 / ADR-044) as the common distribution layer for lab/site
   surfaces — learn from Marimo (Pyodide) and Astro 7 (Rust toolchain) without embedding
   either app.
8. `silo` → credentials; channel policy → `dgk-channels`/Telegram outbox; `process-handoff` →
   `dgk-runner`/`dgk-cli` internals; release/source/artifact primitives → `dgk` operations.
   Promote whenever the duplicated substrate can be consumer-neutral and the `dgk` public
   surface remains product-owned.

## Librarian follow-up

The librarian question is no longer open-ended. The selected base path is:

- `source:v1` contract + `source-git`/`source-local` providers: `specs/features/2026-06-24-source-contract-v1.md`;
- execution plan: `docs/superpowers/plans/2026-06-24-source-contract-v1.md`;
- deferred adapter activation: `specs/features/2026-06-25-source-adapter-activation.md`.

Do not re-open the port-vs-toolbox decision during implementation. Build the base contract first;
only add `source-dispatch` or `source-tarball` when the activation trigger exists.
