# Convergence Roadmap — Rolling Out the Carpet

> Status: working roadmap (2026-06-24). Sequences every sub-project the convergence needs so
> work can start in the `cranky_bassi` devcontainer without re-deciding direction. Governed by
> [`ECOSYSTEM_SUPPLY_MAP.md`](./ECOSYSTEM_SUPPLY_MAP.md) and the 2026-06-24 amendment in
> [`VAULT_SEED_CONVERGENCE.md`](./VAULT_SEED_CONVERGENCE.md).

## How to read this

The convergence is not one plan — it is a sequence of sub-projects. Each one runs its own
`brainstorm → spec → plan → execute` cycle (the librarian, item 1, is the worked example).
This roadmap fixes **what** each sub-project is, **why**, what it **depends on**, its **readiness
gate** (dogfooding: Refarm consumes it first), and its **artifact type**. It does not pre-write
implementation plans for sub-projects whose design decisions are not made yet — those come from
each sub-project's own brainstorm.

## Sub-projects

| # | Sub-project | Artifact | Depends on | Readiness gate | Status |
|---|---|---|---|---|---|
| 0 | UI boundary amendment | doctrine edit | — | — | ✅ done |
| 1 | **Librarian** — `source:v1` + `source-git` | spec + plan | — | Refarm agent materializes vault-seed/agents-lab read-only | ✅ spec + plan |
| 2 | **`apps/refarm` promotion audit** | audit ledger | 1 (read repos) | — (discovery) | ✅ done ([ledger](./APPS_REFARM_PROMOTION_LEDGER.md)) |
| 3 | **npm scope decision** — `@aretw0` vs `@refarm.dev` | ADR + migration plan | — | publish dry-run green under chosen scope | ✅ decided ([ADR-069](../specs/ADRs/ADR-069-npm-scope-canonicalization.md)) — docs sweep pending |
| 4 | **UI/surface blocks supply** — grow `ds` + `homestead` + `dispatch-surface` | spec + plan | 2, 3 | Refarm admin UI (`apps/me`/`apps/refarm`) composed FROM the blocks | ✅ spec'd: 4a [ds tokens](../specs/features/2026-06-25-ds-token-contract.md), 4b [homestead ssr tier](../specs/features/2026-06-25-homestead-ssr-tier.md), 4c [silo collect](../specs/features/2026-06-25-silo-collection-contract.md) |
| 5 | **WASM distribution substrate** — Tractor as common lab/site layer | research + ADR | research (Astro 7) | one surface (lab or site) distributed via the substrate | ✅ [ADR-070](../specs/ADRs/ADR-070-wasm-surface-substrate.md) — Part A (contract + dependency-depth policy) + Part B (Tractor native-first + WASM-fallback) committed; Part C (Astro SSR on Tractor) POC-gated |
| 6 | **`dgk-skills` ⊂ refarm gardening skills** | spec + adapter | 1 | Refarm runs a `dgk` skill via its own skill surface | ✅ taxonomy ([ledger](./GARDENING_SKILLS_TAXONOMY.md)); skill contract deferred to "Refarm as engine" (dogfooding gate) |
| 7 | **Librarian completion** — `source-dispatch` adapter + `source-local` | spec + plan | 1, 4 (dispatch) | agent invokes `source:v1` through dispatch | ◻ deferred |
| 8 | **Consumer bridges** — `silo`, `contacts`+`rate-limiter`, `cli/launch-process` for `dgk` | specs | 3 + second consumer | a second consumer needs the same primitive | ◻ deferred |

## Detail & rationale

### 1. Librarian (done — spec + plan)
`source:v1` contract + `source-git` impl. Unblocks everything: once Refarm can materialize a
clean read-only copy of any repo, it can absorb logic from the ecosystem instead of guessing.
Deferred pieces (`source-dispatch`, `source-local`, `tarball`) tracked in item 7.

### 2. `apps/refarm` promotion audit — recommended next
The accepted critique: `apps/refarm` (1.2M) may concentrate logic that should be reusable blocks.
Concrete smell already visible: `src/renderers.ts` and `src/model-routing.ts` live in the app, but
multi-surface rendering belongs in `homestead`/`dispatch-surface`, and model routing is a
candidate primitive. This sub-project is **discovery, not build**: read `apps/refarm/src` and
produce a promotion ledger — for each unit, "stays in app" vs "promote to `ds`/`homestead`/
`dispatch-surface`/a contract", with the reason. It is cheap, mostly doable read-only, it
operationalizes the dogfooding gate ("apps are thin consumers that prove blocks"), and it is the
direct input to item 4. It is also the first real act of Refarm-absorbing-the-ecosystem — the
librarian's spirit (read to learn) applied to Refarm's own app.

### 3. npm scope decision
`DISTRIBUTION_STATUS.md` publishes contracts as `@aretw0/*`; the live packages are named
`@refarm.dev/*`. Downstream cannot `import { x } from "@…/…"` until the scope is fixed. This is a
governance ADR (decide the scope, the migration mechanics, and the personal→org timing) plus a
mechanical rename/publish-config migration. No code dependency — can be decided early, in
parallel with item 2.

### 4. UI/surface blocks supply — the one the consumer cares most about
Grow `ds` (today: tokens + styles + one Button) and consolidate `homestead` (sdk/ui/styles) +
`dispatch-surface` + `terminal-plugin` into the official block set that consumers compose product
from (cli/tui/web/rpc/http/a2a). Readiness gate: the Refarm admin UI itself is composed from the
blocks, not from app-local code (that is what item 2's audit makes possible). This is where the
boundary amendment becomes real.

**Reframed by item 2's audit** ([ledger](./APPS_REFARM_PROMOTION_LEDGER.md)): the blocks already
exist and Refarm already consumes them — this is **not** an extraction effort. Scope is: grow `ds`
(nascent), make `homestead`/`dispatch-surface` externally consumable (scope + docs + stable API),
and reconcile `credentials/` ↔ `silo`. Raises the weight of item 3 (external blocks need a settled
npm scope).

### 5. WASM distribution substrate
Make Tractor (ADR-049 dual-runtime; ADR-044 browser WASM loading) the common distribution layer
for lab/site surfaces. Treat Marimo (Python→WASM via Pyodide) and Astro 7 (Rust toolchain) as two
language surfaces over one substrate, not two embedded apps. **Requires research first** — Astro 7
is recent; verify its toolchain/WASM story (context7/web) before committing an ADR. Output: an ADR
plus a proof that one surface (the lab or the site) distributes through the substrate.

### 6. `dgk-skills` ⊂ refarm gardening skills
`dgk-skills` (read, search, create, context, daily) is a subset of a broader Refarm gardening
skill set. Map the overlap, define the superset, and provide a compatibility adapter so a
`dgk` skill can run under Refarm's skill surface without a one-shot rename (the convergence doc's
"Skill/package compatibility" promotion candidate).

### 7. Librarian completion (deferred)
`source-dispatch` adapter (wire `source:v1` into `dispatch-surface` for agentic/kernel use) and a
real `source-local` package (live local tree). Built when consumed — `source-dispatch` waits on
item 4's dispatch work; `source-local` waits on a consumer wanting the live tree.

### 8. Consumer bridges (deferred)
Promote `dgk`'s repeated needs into Refarm packages only when a second consumer needs the same
primitive: `silo` (credentials), `contacts`+`rate-limiter` (channels), `cli/launch-process`
(runner). Gated by the dogfood and by the convergence doc's "promote only when consumer-neutral"
rule.

## Sequence

```
1 Librarian ✅
      │  (Refarm can now read the ecosystem)
      ▼
2 apps/refarm audit ──┐         3 npm scope ADR  (parallel, no code dep)
   (discovery)        │              │
      ▼               ▼              ▼
4 UI/surface blocks supply ◄─────────┘
      │
      ├──► 5 WASM substrate (research-gated: Astro 7)
      ├──► 6 dgk-skills overlap
      ├──► 7 Librarian completion (source-dispatch needs item 4)
      └──► 8 Consumer bridges (gated by 2nd consumer)
```

## Working rule

Each numbered item gets its own `brainstorm → spec → plan` before execution. Specs land in
`specs/features/` or `specs/ADRs/`; plans in `docs/superpowers/plans/`. Execution runs in the
`cranky_bassi` devcontainer.

**To start executing:** follow [`CONVERGENCE_EXECUTION_RUNBOOK.md`](./CONVERGENCE_EXECUTION_RUNBOOK.md)
— ordered steps, branches, and verification gates for the `cranky_bassi` session.
