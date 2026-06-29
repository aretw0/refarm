# Convergence Roadmap — Rolling Out the Carpet

> Status: working roadmap (2026-06-24). Sequences every sub-project the convergence needs so
> work can start without re-deciding direction. Governed by
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
| 1 | **Librarian** — `source:v1` + `source-git` | packages + smoke | — | Refarm agent materializes vault-seed/agents-lab read-only | ✅ implemented + smoke green |
| 2 | **`apps/refarm` promotion audit** | audit ledger | 1 (read repos) | — (discovery) | ✅ done ([ledger](./APPS_REFARM_PROMOTION_LEDGER.md)) |
| 3 | **npm scope decision** — `@aretw0` vs `@refarm.dev` | ADR + docs sweep | — | publish dry-run green under chosen scope | ✅ decided + docs sweep done ([ADR-069](../specs/ADRs/ADR-069-npm-scope-canonicalization.md)) |
| 4 | **UI/surface blocks supply** — grow `ds` + `homestead` + `dispatch-surface` | spec + plan | 2, 3 | Refarm admin UI (`apps/me`/`apps/refarm`) composed FROM the blocks | ▶ 4a/4b/4c/4d spec+plans ready (see [factory readiness](./CONVERGENCE_FACTORY_READINESS.md)) |
| 5 | **WASM distribution substrate** — Tractor as common lab/site layer | research + ADR | research (Astro 7) | one surface (lab or site) distributed via the substrate | ✅ [ADR-070](../specs/ADRs/ADR-070-wasm-surface-substrate.md) Parts A/B accepted; Part C POC red |
| 6 | **`dgk-skills` ⊂ refarm gardening skills** | spec + adapter | 1 | Refarm runs a `dgk` skill via its own skill surface | ◻ taxonomy done; activation spec+plan ready |
| 7 | **Librarian completion** — `source-dispatch` adapter + `source-local` | spec + plan | 1, 4 (dispatch) | agent invokes `source:v1` through dispatch | ◑ `source-local` implemented; `source-dispatch` deferred until dispatch consumer |
| 8 | **Consumer bridges** — `silo`, channel policy (`contacts`/rate limits/receipts), `process-handoff` for `dgk` | specs + package/proof slices | 3 + second consumer/control surface | a second consumer or Refarm control surface needs the same primitive | ▶ partially active; 8a Refarm-side ready, 8b package slice active, 8c Refarm-side proof ready |
| 9 | **Executable specs** — generators + codemods over prose | tooling | — | a gated package scaffolds + self-registers via `turbo gen`; generated vault smoke passes | ✅ vault generator implemented; registry has two ready codemods |
| 10 | **Linux async I/O substrate** — `io_uring` research | research + POC | native Rust substrate | Refarm-shaped file workload proves ROI with fallback | ◻ POC planned ([spec](../specs/features/2026-06-25-io-uring-substrate.md)) |
| 11 | **XR/WebXR surface POC** — immersive surface around Refarm | POC | 4, optional 5 | XR-capable browser renders the same Refarm data as 2D fallback | ◻ POC planned ([spec](../specs/features/2026-06-25-xr-surface-poc.md)) |
| 12 | **Vault-seed roadmap assimilation** — sources/ETL, multi-channel publishing, OKF, workspace publishing, Lab WASM helpers | classification + specs | 1, 5, 8, 9 | each future vault-seed slice either consumes a Refarm candidate block or stays explicitly product-local | ▶ classified; activate per lane |

## Detail & rationale

### 1. Librarian (done — implemented + smoke green)
`source:v1` contract + `source-git` impl. Unblocks everything: once Refarm can materialize a
clean read-only copy of any repo, it can absorb logic from the ecosystem instead of guessing.
Deferred pieces (`source-dispatch`, `tarball`) tracked in item 7; `source-local` is now active for
live local tree reads.

Re-verified 2026-06-26:

```bash
pnpm --filter @refarm.dev/source-contract-v1 run test:conformance
pnpm --filter @refarm.dev/source-git run test:conformance
pnpm --filter @refarm.dev/source-contract-v1 run build
pnpm --filter @refarm.dev/source-git run build
pnpm run test:capabilities
pnpm run source:librarian:smoke
pnpm run source:librarian:local-smoke
```

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
Historical docs published contracts as `@aretw0/*`, while the live packages were already named
`@refarm.dev/*`. ADR-069 fixes the rule: Refarm blocks/contracts publish under `@refarm.dev`;
`@aretw0/*` remains for `vault-seed`/DGK products. The docs sweep has been applied so release docs
no longer ask operators to publish Refarm blocks under the personal scope.

Execution packet retained for audit: `specs/features/2026-06-25-npm-scope-doc-sweep.md` and
`docs/superpowers/plans/2026-06-25-npm-scope-doc-sweep.md`.

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

Activation packet: `specs/features/2026-06-25-skill-runtime-activation.md` and
`docs/superpowers/plans/2026-06-25-skill-runtime-activation.md`.

### 7. Librarian completion (partially active)
`source-dispatch` adapter (wire `source:v1` into `dispatch-surface` for agentic/kernel use) and a
real `source-local` package (live local tree). `source-local` is implemented and reports
dirty/untracked state explicitly. `source-dispatch` still waits on item 4's dispatch work and an
agentic consumer.

Activation packet: `specs/features/2026-06-25-source-adapter-activation.md` and
`docs/superpowers/plans/2026-06-25-source-adapter-activation.md`.

### 8. Consumer bridges (partially active)
Promote `dgk`'s repeated needs into Refarm packages only when a second consumer or an existing
Refarm control surface needs the same primitive: `silo` (credentials), channel policy
(`contacts`, rate limits, receipts, dry-run/review gates), and `process-handoff` (runner).
Gated by dogfood and by the convergence doc's "promote only when consumer-neutral" rule.

Telegram is the fixture, not the upstream product. `vault-seed` keeps Telegram API calls,
Markdown formatting, inbox note writing, Lab notebooks, and `dgk` command UX. Refarm absorbs only
the channel-neutral evidence and policy shapes that also fit `dispatch-surface`/Farmhand channel
control.

Activation packet: `specs/features/2026-06-25-consumer-bridges-activation.md` and
`docs/superpowers/plans/2026-06-25-consumer-bridges-activation.md`.

8a, 8b, and 8c now also have focused packets:

- 8a `silo` bridge: `specs/features/2026-06-26-vault-seed-silo-bridge.md` and
  `docs/superpowers/plans/2026-06-26-vault-seed-silo-bridge.md`.
- 8b channel policy: `specs/features/2026-06-26-channel-policy-bridge.md` and
  `docs/superpowers/plans/2026-06-26-channel-policy-bridge.md`.
- 8c process-handoff provenance: `specs/features/2026-06-26-process-handoff-provenance-bridge.md`
  and `docs/superpowers/plans/2026-06-26-process-handoff-provenance-bridge.md`.

### 9. Executable specs (generators + codemods)
Prose specs are right for **decisions** (ADRs) but low-leverage for **mechanical** work. Three
layers, three forms: greenfield → **generator** (Refarm already has `turbo gen package` with typed
templates incl. `contract-v1`); recurring transform of existing code → **codemod** (the gate-list
registration — done now by extending the generator's `modify` actions); one-off/cross-file AST
transforms → lean on the ecosystem (`codemod.com` / `ast-grep` / `ts-morph`) when a change spans
many files (e.g. the `credentials/` re-export migration). **Delivered:** the gate-registration +
changeset are now emitted by `turbo gen package` (`turbo/generators/config.ts`), turning
`PACKAGE_ACCEPTANCE_CHECKLIST.md` steps 2/3/6 from prose into code. **Discipline:** codemod-ify the
recurring, keep one-offs and decisions as prose.

Codemod registry packet: `specs/features/2026-06-25-codemod-registry-contract.md` and
`docs/superpowers/plans/2026-06-25-codemod-registry-contract.md`. The registry now has two ready
entries: `ds-token-adoption` and `package-workspace-adoption`.

### 11. XR/WebXR surface POC (frontier)
XR is a surface around Refarm, not a core dependency. The first work is a POC that renders the same
Refarm data through a 2D `homestead` fallback and an XR-capable WebXR path. It must keep A-Frame or
three.js isolated to the POC until evidence justifies a package.

POC packet: `specs/features/2026-06-25-xr-surface-poc.md` and
`docs/superpowers/plans/2026-06-25-xr-surface-poc.md`.

### 12. Vault-seed roadmap assimilation — classified, activate per lane
`vault-seed`'s future roadmap is now part of convergence planning:

- v0.5 source IaC (`lab.sources.json`, `ExtractionProfile`, cache/staging, `target: "auto"`)
  attaches to `source:v1`, artifact/provenance, retention policy, and model/task contracts.
- v0.5/v0.6 publishing expansion (Telegram, Mastodon, Bluesky, Nostr, later Instagram/newsletter)
  attaches to 8b channel policy and `silo` identity namespaces; provider adapters stay downstream.
- v0.7 primitive adoption (`rate-limiter`, `contacts`, `silo`, skill metadata) is the item 8 bridge
  lane with candidate packages, codemods, and compatibility wrappers.
- `dgk publish workspace`, custom distributions, package provenance, and changelog-as-content
  attach to item 9 generator/codemod work plus `release-engine`.
- Lab WASM helpers, feed/OpenGraph readers, and refresh workflows attach to item 5 WASM substrate
  and source/artifact contracts.
- OKF, JSON-LD, semantic graph, and knowledge export are future content/knowledge manifest pressure;
  keep vault-specific mapping downstream until another consumer proves the same envelope.

This item is a guardrail, not a new mega-project. Each row activates only through the existing
lane's spec/plan, with a consumer proof and a downstream rollback path.

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
`specs/features/` or `specs/ADRs/`; plans in `docs/superpowers/plans/`.

## Planning frontier

These are the next things worth deepening before writing broad code. They are deliberately phrased
as codemod/generator work when a repeatable transform is cheaper and safer than manual edits.

1. **Codemod candidates:** only codemod recurring transforms. The current ready entries are
   `ds-token-adoption` and `package-workspace-adoption`; keep ADR decisions and one-off prose as
   docs.
2. **XR/WebXR around the framework:** Task 1/2 POC is started under
   `validations/xr-surface-poc/` with a renderer-neutral Refarm surface map and WebXR capability
   probe. Keep A-Frame/three.js isolated to the validation directory until static preview and
   browser/device evidence exist.
3. **Linux async I/O (`io_uring`) substrate:** Task 1/2 probe is started under
   `validations/io-uring-substrate/`. Current WSL2/devcontainer evidence reports
   `status: "blocked"` (`EPERM`), so keep fallback mandatory and only continue the `io_uring`
   implementation path on a host/container that reports `available`.

Item 5 note: Astro 7/WASI Part C is closed red for now. The evidence remains under
`validations/astro-wasi-ssr/`; ADR-070 Parts A/B remain active.

Closed on 2026-06-27: the generated-vault inventory lane now has a Refarm-side consumer proof
(`scripts/ci/test-vault-seed-release-consumer.mjs`) that generates a vault fixture, reads the
generated `package.json` and `inventory.json`, and verifies every `@refarm.dev/*` package consumed
by the fixture is covered by the `vault-seed-ready` release selection and package checks.

Read [`CONVERGENCE_FACTORY_READINESS.md`](./CONVERGENCE_FACTORY_READINESS.md) before starting item
4, 5, 6, 7, 8, 9, 10, or 11. It records which items are execution-ready, which are deliberately gated, and
which exact spec/plan must be written next.

**To start executing:** follow [`CONVERGENCE_EXECUTION_RUNBOOK.md`](./CONVERGENCE_EXECUTION_RUNBOOK.md)
— ordered steps, branches, and verification gates.

**Integration gates (so the factory does not stop mid-build):**
- Every new package follows [`PACKAGE_ACCEPTANCE_CHECKLIST.md`](./PACKAGE_ACCEPTANCE_CHECKLIST.md)
  — both gate lists (`test-capabilities` + `gate-smoke-contracts`), `validate-packages`,
  build-order, ownership, and a changeset.
- Cross-repo "consumer proof" steps use [`DEV_CROSS_REPO_CONSUMPTION.md`](./DEV_CROSS_REPO_CONSUMPTION.md)
  — local tarball (`pnpm pack` → `file:`) until `@refarm.dev` packages publish.
