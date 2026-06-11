# Vault Seed Convergence

Status: calibration note for keeping Refarm and `vault-seed` complementary.

This document records what the `vault-seed` consumer is proving and where Refarm
should harden shared primitives instead of absorbing the product workflow.

## Current Read

`vault-seed` has moved beyond a static Obsidian template. It is becoming a
local-first knowledge operating kit with three clear surfaces:

| Surface | Owner | Role |
| --- | --- | --- |
| Astro site | `vault-seed` | Public reading, navigation, graph, timeline, accessibility, and discoverability. |
| Marimo Lab | `vault-seed` | Local/offline analysis, dataset exploration, feed/outbox review, and human decisions. |
| `dgk` CLI/scripts | `vault-seed` | Vault-local operation: validation, lab ETL/export, Obsidian launch, note bridge, and package scaffolding. |

The important product signal is that `vault-seed` is the interface for people
who want a sovereign knowledge vault. It should not become a Refarm runtime
distribution, and Refarm should not reimplement its vault UX.

## Observed Consumer Shape

The current `vault-seed` repository is already a small distribution, not only a
template. It has separable packages for:

| Package/surface | Current signal | Refarm lesson |
| --- | --- | --- |
| `@aretw0/dgk-cli` | Vault-local commands for validate, lint, setup, check, lab, publish. | Product CLIs need a small cockpit, not a forced Refarm command vocabulary. |
| `@aretw0/dgk-runner` | Commands receive an injectable `(cmd, args) => Promise<void>` runner. | Refarm can compose later through a runner adapter instead of replacing `dgk`. |
| `@aretw0/dgk-astro-plugins` | Remark plugins for wiki links, images, callouts, and slug behavior. | Rendering conventions are consumer UX; reusable policy is limited to contracts and checks. |
| `dgk-lab-runtime` | Python helpers for local-vs-packaged notebook boundaries. | Local ETL and published analysis need an explicit runtime boundary. |
| `dgk-skills` | Vault-oriented skills such as read, search, create, context, daily. | Skill compatibility should be additive and adapter-based, not a one-shot rename. |

This is healthy duplication at the product edge. The risk would be duplicating
runtime contracts, process handoffs, provenance envelopes, package integrity, or
workspace health rules in ways that drift from Refarm.

## 2026-06-11 Read-Only Calibration

The latest read-only pass over the adjacent writing vault and `vault-seed`
reinforces the boundary rather than changing it:

- the writing vault exposes three themed work streams plus proposal, commitment
  letter, and draft scaffolding; those filenames are enough pressure signal, so
  Refarm should not ingest or quote the draft bodies;
- the first two streams pressure Refarm's extension governance and citizen-data
  validation POCs without requiring product naming or submission-specific
  language;
- the third stream is better represented by `vault-seed`'s own vault cockpit and
  by Refarm's generic artifact/provenance contracts, not by note UX in
  `apps/refarm`;
- `vault-seed` already has a mature local command surface around `dgk check`,
  `dgk lab`, notebook ETL/export, outbox preparation, site build, graph smoke,
  and lab manifests.

That means the next convergence work should be adapter-shaped: make Refarm's
process, health, artifact, and provenance contracts easy for `dgk` or a second
consumer to call later, while leaving publishing, notebook, and vault language
inside the consumer.

## Astro And Marimo Lessons

`vault-seed` is proving two lessons Refarm should absorb without taking over the
product:

1. **Astro is a publication boundary.** The site owns reading experience,
   navigation, graph interactions, accessibility, and published notebook
   embedding. Refarm should not own that UI, but it should provide validation
   primitives that a consumer site can call before publish.
2. **Marimo notebooks are analysis consumers.** Published HTML/WASM notebooks
   should read prepared snapshots. Local ETL, browser automation, OCR, secrets,
   authenticated APIs, and long-running extraction belong before export in
   local/CI runners.
3. **The contract is the artifact.** JSON, CSV, Parquet, manifests, hashes,
   quality reports, and audit trails are the durable boundary between Refarm
   tasks and consumer labs.

For Refarm, that points toward generic task artifact and provenance contracts,
not toward embedding Marimo or Astro into the core app.

## Audience Overlap

The overlap is real but the audience entry point differs:

| Audience | Enters Through | Needs From Refarm Later |
| --- | --- | --- |
| Digital gardeners and researchers | `vault-seed` template, Obsidian, Markdown, published site | Optional agent runtime, validation, provenance, and task handoffs. |
| Operators maintaining many vaults/projects | Refarm CLI/runtime | Stable consumer calibration, external workspace health, and repeatable finish gates. |
| Teams with local-first data workflows | `vault-seed` distributions | Ingestion contracts, schema validation, audit trails, and capability-scoped automations. |
| Agent authors | `dgk` skill packages now, Refarm plugins later | A compatibility path from skills/tools to Refarm manifest/runtime surfaces. |

The convergence target is not one CLI replacing the other. It is a layered path:

```text
dgk CLI = product-local cockpit for vault users
Refarm = shared runtime, handoff, validation, model/task, and plugin substrate
```

`dgk` can eventually call Refarm primitives when present, while remaining useful
without Refarm installed.

## Second And Third Consumers

The same primitives must be shaped for more than `vault-seed`. Local writing
vaults, governed publication workflows, plugin hosts, and future project CLIs
will all need pieces of the substrate without adopting the whole Refarm app.

That makes the promotion bar higher:

- promote contracts that describe work, evidence, provenance, capabilities, and
  process continuation;
- keep product vocabulary, folder conventions, editor workflows, and publishing
  UX at the consumer edge;
- prefer `.refarm/` sidecar state or explicit checked-in policy over surprising
  root-level configuration files;
- require read-only mode to be a first-class posture for mirrors, archives, and
  work vaults.

This is how Refarm can become the operator's daily-driver agent while still
being safe to introduce into projects that are not Refarm-shaped.

## Boundaries

Keep these boundaries explicit:

- `vault-seed` owns vocabulary, onboarding, PARA layout, Obsidian/Marimo/Astro
  flows, distribution templates, and vault-specific UX.
- `Refarm` owns reusable runtime, model/task execution, JSON handoffs,
  external-consumer calibration, capability policy, plugin lifecycle, and shared
  health/complexity primitives.
- `agents-lab` remains a proving ground for agent skills/tools until repeated
  use makes a contract worth promoting.
- Read-only evidence vaults and external writing drafts provide evidence only.
  They must not receive generated Refarm config or mutation unless the operator
  explicitly changes their status.

## Convergence Primitives

These are the useful shared primitives to harden in Refarm before coupling any
consumer CLI directly to Refarm internals:

1. **External workspace profile**
   - `refarm resume --json`
   - `refarm check --next-action --json`
   - `refarm health --policy --json`
   - `refarm health --suggest-policy --json`

   `vault-seed` can use these for calibration without importing app internals.

2. **Command/process handoff**
   - Product CLIs such as `dgk` should be able to expose commands as structured
     process specs instead of ad hoc shell strings.
   - Refarm should keep the reusable representation in `@refarm.dev/cli`; `dgk`
     may later adapt to that shape.
   - The existing `dgk-runner` injection point is the likely composition seam:
     keep `dgk` commands product-local, but allow a future runner adapter to
     execute through Refarm `ApplicationProcessSpec`/`CommandProcessSpec` and
     JSON handoffs when Refarm is installed.

3. **Vault/source provenance**
   - `vault-seed` already wants `source`, `run_id`, `agent`, `dataset_version`,
     hashes, and quality reports for ingestion.
   - Refarm should not own vault-specific schemas, but it can own generic
     provenance and effort/task envelopes that vault pipelines can reference.
   - Lab outputs should be represented as task artifacts with stable paths,
     media type, producer command, input hashes, and review state. Vault-specific
     fields stay in `vault-seed`.

4. **Skill/package compatibility**
   - `vault-seed` currently scaffolds Pi-style skill and extension packages.
   - Refarm should provide a future adapter path where those packages can become
     manifest-declared skills/tools without requiring a one-shot rename or
     product migration.

5. **Complexity and workspace health**
   - Large-file, generated-output, docs, and lab artifact pressure belongs in
     `@refarm.dev/health` as reusable auditing.
   - Consumer-specific allowances stay in that consumer's `.refarm/config.json`
     or equivalent checked-in policy.

## What Not To Do

- Do not make Refarm a required dependency for generated vaults.
- Do not move `vault-seed` onboarding, Astro UI, Marimo notebooks, or PARA
  conventions into Refarm.
- Do not duplicate the `dgk` product CLI in `apps/refarm`.
- Do not auto-write `.refarm/config.json` into a vault just because calibration
  suggested a policy.
- Do not treat Pi naming inside `vault-seed` packages as a long-term Refarm
  semantic center. Treat it as compatibility until an adapter is ready.

## Migration Shape

The pragmatic migration path is additive:

1. Keep `dgk` as the vault-local command surface.
2. Let Refarm inspect `vault-seed` as an external consumer through read-only
   templates.
3. Add optional `.refarm/config.json` only in writable consumer repos after
   review, not in read-only mirrors.
4. Promote repeated `dgk` needs into Refarm shared packages only when a second
   consumer or repeated Refarm command needs the same primitive.
5. Later, let `dgk` detect Refarm and delegate advanced flows such as runtime
   tasks, model-backed curation, plugin/package verification, and finish gates.

This keeps `vault-seed` sovereign for its users and lets Refarm become the
daily-driver substrate without centralizing every workflow in `apps/refarm`.

## Promotion Candidates

Promote only the repeated, non-vault-specific parts into Refarm:

| Candidate | Promote to Refarm when | Keep in `vault-seed` |
| --- | --- | --- |
| Process runner adapter | A second consumer wants structured process execution and JSON continuation. | `dgk lab`, `dgk publish`, Obsidian-specific commands. |
| Task artifact manifest | Refarm tasks need to hand off generated datasets/reports to labs or docs. | Dataset names, vault paths, public Lab conventions. |
| Provenance envelope | Multiple consumers need source/run/hash/review metadata. | Feed schemas, PARA metadata, editorial workflow labels. |
| Workspace health policies | Large-file, generated-output, notebook/export checks become reusable. | Vault-specific folder allowances and publication UX checks. |
| Skill compatibility adapter | `dgk-skills` or `agents-lab` skills need to run under Refarm manifests. | Skill copy, onboarding language, and vault commands. |

Near-term Refarm work should therefore favor small contracts around process
execution, artifact provenance, and external workspace health. The `vault-seed`
CLI can stay independent until those contracts are stable enough to consume.

The first shared home for task/lab output metadata is
`@refarm.dev/artefact-contract-v1`: it keeps the existing managed artefact
lifecycle and adds task artefact manifests for generated datasets, reports,
receipts, audit trails, logs, and nested manifests. Consumer-specific schemas
stay outside that package.

## External Draft Pressure

Local external drafts should continue to pressure Refarm indirectly:

- Theme 1 maps to sandboxed plugin governance, capability policy, manifest
  integrity, and revocation.
- Theme 2 maps to citizen data portability, consent, auditability, and
  offline-first trust boundaries.
- Theme 3 maps to `vault-seed`: note/vault workflows, provenance, publication
  outbox, local lab analysis, and human-reviewed agent assistance.

Because evidence vaults are read-only by default, evidence from those drafts
should become Refarm docs, shared primitives, or explicitly scoped
`vault-seed` changes, never silent writes into a mirror.
