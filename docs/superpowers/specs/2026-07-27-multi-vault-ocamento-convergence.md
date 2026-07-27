# Multi-vault ocamento — the convergence is already planted (migration, not invention)

> 2026-07-27. Answers the operator's "ocamento dos outros vaults de ~/git" + the CRM×ERP framing.
> Grounded by a structural survey of three vaults (professional `~/git/vault`, `~/git/rcdc5`,
> `~/github/coop-vault`) + a read of rcdc5's own convergence design
> (`rcdc5/docs/ARQUITETURA-CONVERGENCIA.md`, 2026-03-12) + a measurement of refarm's current contract
> lattice. See memories `vaults-converge-to-crm-erp`, `convergence-lane`, `assimilate-rcdc5-before-solving-alm-problems`.

## The field (verified)

All the creator's vaults are the **same `digital-gardening-kit` v0.0.1 lineage** (PARA numbered folders,
Obsidian/Foam, `standard-version`). **Only vault-seed is on refarm's rails.** The professional vault
(`~/git/vault` = github `job-vault-bk`), `rcdc5`, and `coop-vault` are all **pre-refarm** — none consume
`@refarm.dev/*`. So each vault's "ocamento" is the **same migration** vault-seed already completed
(consume the SDK, keep only a thin product layer), not a refresh.

The two recurring axes the operator named — **CRM** (entities/people/orgs + relations) and **ERP**
(tasks/demands/tickets/resources + state) — are real and consistent across all vaults. The keystone is
the professional vault's explicit **"Motor Log-vs-Estado"**: an append-only dated log (daily notes) +
current state *derived by query* (dashboards/kanban/burndown). That is exactly refarm's records +
task-events + projections model.

## The headline: refarm already assimilated the convergence design

rcdc5's March design assigned refarm the role of "canonical JSON-LD layer" in a 4-project arc
(Trellis orchestration × Refarm canonical × RCDC5 profile/route × iAlm OSLC scraper). Since March,
refarm grew a **contract lattice** that fills nearly the whole design — and the contracts' own docstrings
prove they were lifted from these very vaults ("two independent note-boxes: a vault template and **an
operational requirements vault**" = vault-seed + rcdc5; "two vault POCs" = vault-seed's two flavors).

| Design role | refarm contract that already fills it |
|---|---|
| Canonical JSON-LD | `records-contract-v1` (+ `./yaml` YAML-LD codec) — vault-seed consumes |
| rcdc5's `Profile→canonical→Sink` engine | `vault-contract-v1` — SEARCH/EXTRACT/ORGANIZE/PROFILE, matcher-is-data `VaultProfile`/`VaultRule`, `VaultOrganizePlan` = routing, `extract → records` |
| `source_*` immutable envelope + drift | `provenance-contract-v1` — `channel/sourceFile/sourcePath/originLink/contentSha256/license/privacy` + open `[extra]` for `alm_source_url`; `sha256-shape` = drift-on-reingest |
| Idempotent re-sync preserving local overlay | `enrichment-contract-v1` — `dry-run/apply`, `EnrichmentChange`/`EnrichmentSkipped` + provenance |
| Work-item / ticket + FSM + Log-vs-State | `task-contract-v1` — `Task` (status FSM, `parent_task_id`, `assigned_to`) + `TaskEvent` (append-only log) + `TaskSummary.by_status` (rollup) |
| OSLC/scraper adapter | `source-contract-v1` (`SourceProvider` discover/materialize; "a scraped system" is a valid source) + `source-web` (http/`web:` refs already work) |
| Multi-writer sync (coop-vault) | `sync-contract-v1` + `sync-loro` (CRDT) |
| Collective workspace (coop-vault) | `workspace-access-contract-v1` + `identity/authorization/credentials-contract-v1` |
| Orchestration (Trellis role) | `automation-contract-v1` |

## The real remaining work (measured, not assumed)

1. **Consumer migration — the bulk.** Make each pre-refarm vault CONSUME the lattice, replacing
   hand-rolled engines. rcdc5's `@rcdcp/extractor-engine` (`ExtractionProfile`/`ExtractionSink`) → `vault:v1`;
   its `ccm_*`/`alm_*` frontmatter → `provenance:v1`; its `WorkItemContent` → `task:v1` + `provenance:v1`.
   The professional vault's `Demanda`/`Contato`/daily-log → same. **vault-seed is the proven template.**
2. **One genuinely-missing PROVIDER: `source-alm` / `source-oslc`.** A `source:v1` provider (sibling of
   `source-web`) wrapping iAlm's OSLC read primitives (`discoverProjectArea → listArtifacts → fetchById →
   html→md`) + the cookie/QR session (rcdc5's `scraper-playwright` is the working reference). This is the
   creator's own "Fase A" (headless scraper) expressed as a refarm source, not a bespoke CLI.
3. **Thin gap (optional): `priority` on `task:v1`.** rcdc5's/professional's work-items carry priority;
   `Task` does not. An optional `priority?` (open string) closes it without breaking readers. Weigh only
   under real need — matcher-is-data/tags can carry it meanwhile.

## Reconciling the creator's March phases (A–D) with today

- **Fase A (headless scraper)** → build `source-alm`/`source-oslc` as a `source:v1` provider (item 2 above).
- **Fase B (JSON-LD intermediate + `refarm-jsonld-artifact` profile)** → largely DONE: `records-contract-v1`
  IS the canonical form; the "profile that consumes JSON-LD" is a `vault:v1` EXTRACT surface.
- **Fase C (Trellis orchestrator)** → `automation-contract-v1` is the seam; Trellis calls refarm surfaces
  via CLI exec today, WASM (WIT) when ready — matches the creator's §6 "domain-functions protocol" note.
- **Fase D (refarm as data hub, vault as projection)** → already the model: records in the silo,
  `content-projection` derives the Markdown view. `@refarm/source-ialm` = item 2; `@refarm/view-obsidian`
  = a projection consumer.

## Recommended first atomic step (fork for the operator)

The foundation is planted, so the honest next pass is one of these — each small, each provable:

- **(A) Prove one vault migration.** Take rcdc5's `WorkItemContent` + `ccm_*` frontmatter and show it is
  expressible as `task:v1` + `provenance:v1`, with a consumer-contract test (the vault-seed pattern). Smallest
  pass that validates the whole work-item/source path end-to-end. **Recommended** — highest signal, lowest risk.
- **(B) Build the one missing provider.** `source-alm`/`source-oslc` (`source:v1`), unlocking the creator's
  "immediate value" (auto-scraping into the lattice). Bigger, but delivers live data flow.
- **(C) Reconcile the design docs.** Update rcdc5's March `ARQUITETURA-CONVERGENCIA.md` (and cross-link this
  spec) to record that refarm already fills the roles, leaving only migration + `source-alm`. Cheapest; locks
  shared understanding before code.

## SDK-first guardrail

Nothing here app-couples. The generic lives in refarm's contracts (already true); each vault keeps its product
layer (labels, PARA routing map, ALM vocab, rubrics) as **matcher-is-data profiles**, never contract edits.
Order (per `sdk-first-not-app-coupled`): finish the creator's own vaults first; external consumers (doceria) after.
