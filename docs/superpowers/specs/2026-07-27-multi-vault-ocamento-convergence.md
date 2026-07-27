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

## Agreed program (operator-chosen sequence C → A → B)

The foundation is planted, so the work is a three-step ant-journey, each pass small, provable, and leaving
durable material:

- **(C) Reconcile the design docs — DONE 2026-07-27.** Annotated rcdc5's March `ARQUITETURA-CONVERGENCIA.md`
  with a "Reconciliação 2026-07-27" block recording that refarm already fills the roles (design→lattice table),
  the revised A–D, the sovereign boundary below, and this sequence. This spec is its refarm-side mirror.
- **(A) Prove one vault migration — DONE 2026-07-27.** `examples/reqbench-t3/src/workitem-task.test.ts`
  proves rcdc5's `ccm_*` work-item maps to `task:v1` (Task + TaskEvent log + by_status) + `provenance:v1`,
  overlay preserved outside both, sovereign boundary asserted. 5/5 green, type-check clean.
- **(B) Build the one missing provider — DONE 2026-07-27 (toolkit).** `packages/source-oslc` — the generic
  OSLC/Jazz read toolkit (request contract, fetch driver w/ 401 re-auth, folder→artifact crawl, RDF parsing,
  traceability links, attachments), 7/7 green; reqbench-t3 rewired to consume it (duplication dropped, full
  suite 90/1-skip green). NOTE: this is the OSLC *dialect toolkit*; a full `source:v1` `SourceProvider` class
  (materialize/discover + a session/auth module) wrapping it is the next extension.

## Sovereign boundary (the rule governing every assimilation)

Operator's directive: **refarm assimilates the GENERIC of OSLC and of authentication; the SERPRO-specific
stays in rcdc5** as product/config (matcher-is-data), never in a contract.

- **→ refarm (generic):** the OSLC protocol verbs (`discoverProjectArea → listArtifacts → fetchById →
  html→md`); the auth *patterns* (cookie/QR session persistence, OAuth-redirect) via the existing
  `credentials/identity/authorization-contract-v1`. iAlm's `extrator_alm/` + rcdc5's `scraper-playwright`
  are the reference implementations to distil.
- **↛ stays in rcdc5 (SERPRO product):** SerproID `tokenAuth`/`ni` payload, `alm.serpro` base URLs, the
  UST catalog, `codar` code labels, SIGED field names, the RM taxonomy (`cdu/rn/nf/fun`, `01-demanda…15-colecoes`),
  the PARA routing map. Refarm never imports SERPRO vocab; rcdc5 never re-rolls the generic.

## `almtask` — folded in (the write-back direction)

`~/git/rcdc5/almtask` (Python) is the *inverse* of the read adapter: it **generates** work-items into an
external ALM from a UST service catalog + Outlook `.ics` + recurring-task YAML → import CSV
(`ID, Resumo, Descrição, Tipo, Responsável, Planejado para, Tags, Estimativa, Grupo/Item de UST`). Its
**generic idea** — a *work-item emitter / write-back* from (catalog + schedule + recurrence rules) — is an
assimilation candidate (a future `source:v1` write face or a dedicated capability). The UST catalog and the
SERPRO CSV columns stay in rcdc5 per the boundary above. Capture now, build under the same C→A→B discipline.

## SDK-first guardrail

Nothing here app-couples. The generic lives in refarm's contracts (already true); each vault keeps its product
layer (labels, PARA routing map, ALM vocab, rubrics) as **matcher-is-data profiles**, never contract edits.
Order (per `sdk-first-not-app-coupled`): finish the creator's own vaults first; external consumers (doceria) after.
