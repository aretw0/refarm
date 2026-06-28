# Vault Seed Convergence

Status: calibration note for keeping Refarm and `vault-seed` complementary.

This document records what the `vault-seed` consumer is proving and where Refarm
should harden shared primitives instead of absorbing the product workflow.
The direction is stronger than "integration": `vault-seed` is a product that can
be powered by Refarm capabilities. This complements the native Refarm product
path: Refarm also has its own CLI, apps, runtime-agent, and operator workflows.
Users should see a coherent knowledge-vault product when they enter through
`vault-seed`; `dgk` should import reusable Refarm blocks underneath and fill its
own labels, commands, package names, and vault semantics.

## Current Read

`vault-seed` has moved beyond a static Obsidian template. It is becoming a
local-first knowledge operating kit with three clear surfaces:

| Surface | Owner | Role |
| --- | --- | --- |
| Astro site | `vault-seed` | Public reading, navigation, graph, timeline, accessibility, and discoverability. |
| Marimo Lab | `vault-seed` | Local/offline analysis, dataset exploration, feed/outbox review, and human decisions. |
| `dgk` CLI/scripts | `vault-seed` | Vault-local operation: validation, lab ETL/export, Obsidian launch, note bridge, and package scaffolding. |

The important product signal is that `vault-seed` is the interface for people
who want a sovereign knowledge vault. It should not become a Refarm-branded
runtime distribution, and Refarm should not reimplement its vault UX. But
`vault-seed` should give up duplicated substrate when Refarm can supply it as
SDK, package, crate, generator, codemod, or runtime primitive.

## Observed Consumer Shape

The current `vault-seed` repository is already a small distribution, not only a
template. It has separable packages for:

| Package/surface | Current signal | Refarm lesson |
| --- | --- | --- |
| `@aretw0/dgk-cli` | Vault-local commands for validate, lint, setup, check, lab, publish. | Product CLIs need a small cockpit, not a forced Refarm command vocabulary. |
| `@aretw0/dgk-runner` | Commands receive an injectable `(cmd, args) => Promise<void>` runner. | `dgk` should become powered by Refarm SDK primitives internally while keeping its own package, binary, and command vocabulary. |
| `@aretw0/dgk-astro-plugins` | Remark plugins for wiki links, images, callouts, and slug behavior. | Rendering conventions are consumer UX; reusable policy is limited to contracts and checks. |
| `dgk-lab-runtime` | Python helpers for local-vs-packaged notebook boundaries. | Local ETL and published analysis need an explicit runtime boundary. |
| `dgk-skills` | Vault-oriented skills such as read, search, create, context, daily. | Skill compatibility should be additive and adapter-based, not a one-shot rename. |

This is healthy specialization at the product edge. The risk is letting
runtime contracts, process handoffs, provenance envelopes, package integrity,
source materialization, release policy, workspace health rules, skills, or
agent/runtime loops drift as `vault-seed`-local infrastructure.

## 2026-06-12 Active Consumer Read

A read-only pass over the active `vault-seed` checkout shows a consumer moving
faster than its published surface. The checkout is materially dirty and its
`develop` branch is both ahead of and behind `origin/main`, so these signals are
architecture pressure, not a release contract.

The useful convergence details are concrete:

| Surface | Observed signal | Refarm action |
| --- | --- | --- |
| `dgk-runner` | Exposes a tiny `(cmd, args, opts) => Promise<void>` spawn contract, and `dgk` commands accept an injected runner. | Keep Refarm process specs JSON-first and SDK-friendly, so `dgk` can import the primitive internally without changing command code or product identity. |
| `dgk etl` | Runs a fixed local pipeline: note index, feed sources, publication outbox, lab datasets. | Treat ETL stages as task processes with artifact/provenance outputs, not as vault-specific Refarm commands. |
| `dgk outbox` / `dgk inbox` | Channel commands are product-local today and route Telegram through scripts. | Promote channel-independent contracts only: contacts, rate limits, receipts, dry-run reports, and review gates. |
| `silo.js` | Stores publishing-channel credentials under `~/.dgk/silo.json` and explicitly says model/AI keys come from `refarm sow`. | Harden `@refarm.dev/silo` as the model/runtime credential owner; later expose a scoped publishing credential adapter instead of merging all secrets. |
| `@aretw0/dgk-channels` | Temporary bridge for contact topology and platform-agnostic rate limiting. | Candidate-active for a Refarm channel policy/evidence contract; split `contacts` and `rate-limiter` later only if the contract needs independent versioning. |
| Astro config | Owns published reading UX, wiki links/images, callouts, sidebar intent routing, Lab links, Mermaid rendering, and attachment/vault JSON generation. | Refarm should provide publish preflight and artifact manifests; Astro rendering remains a consumer concern. |
| Marimo manifest | Lists publishable notebooks with `title`, `source`, `output`, `description`, and `publish`. | Align with `@refarm.dev/artifact-contract-v1` task artifacts so labs can consume prepared snapshots without Refarm owning notebooks. |
| Text scoring | `avaliar_textos.py` delegates to a deterministic `text_scorer` and emits JSON reports. | Continue maturing Refarm's dependency-free text-quality contract and leave vault profiles/rubrics in consumers. |

This confirms the layering target:

```text
dgk command -> dgk runner API -> Refarm SDK primitive -> artifacts/evidence
```

The first integrations should be internal and optional where compatibility
requires it. A vault without Refarm SDK packages should keep working through
the local implementation, while maintained `dgk` packages should increasingly
import Refarm primitives by default and emit richer process metadata,
artifacts, channel evidence, release evidence, and health signals. This is
"powered by Refarm", not a replacement of `dgk` by the Refarm CLI.

Refarm now exposes the first generic building block for that path:
`@refarm.dev/launch-process` provides `createLaunchProcessSpecFromRunner` and
`createLaunchProcessRunner`. These helpers accept the same runner-shaped inputs
that `dgk` already uses, keep execution shell-free, and preserve optional `cwd`,
`display`, and package-manager metadata for later handoffs.
`@refarm.dev/cli/launch-process` remains a compatibility re-export for existing
Refarm callers, but consumers should use the leaf package to avoid the full CLI
dependency closure.
`@refarm.dev/artifact-contract-v1` also accepts the same tokenized process shape
inside `ArtifactProvenance.process`, so datasets, reports, notebook snapshots,
and publication receipts can point back to the exact process boundary that
produced them. The process points to consumer-owned scripts or binaries; Refarm
does not distribute vault ETL, Astro, Marimo, or publication scripts through the
artifact contract.

The Lab/outbox mapping should stay generic: Lab datasets use role `dataset` with
labels such as `lab`, publication outbox files use role `manifest` with labels
such as `publication` and `outbox`, and notebook exports use role `report` with
labels such as `lab`, `notebook`, and `snapshot`. The labels carry consumer
semantics while Refarm validates the common evidence shape.

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

`dgk` can eventually import Refarm SDK primitives internally when present, while
remaining useful without Refarm installed.

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
   - Refarm should keep the reusable representation in
     `@refarm.dev/launch-process`; `dgk` may later import that SDK primitive
     behind its existing runner API.
   - The existing `dgk-runner` injection point is the likely composition seam:
     keep `dgk` commands product-local, but allow the runner implementation to
     emit Refarm process specs and JSON handoffs when the SDK is installed.
   - The first reusable adapter is
     `createLaunchProcessRunner`/`createLaunchProcessSpecFromRunner` in
     `@refarm.dev/launch-process`; deeper task recording can wrap the same
     process boundary later.

3. **Vault/source provenance**
   - `vault-seed` already wants `source`, `run_id`, `agent`, `dataset_version`,
     hashes, and quality reports for ingestion.
   - Refarm should not own vault-specific schemas, but it can own generic
     provenance and effort/task envelopes that vault pipelines can reference.
   - Lab outputs should be represented as task artifacts with stable paths,
     media type, producer command, input hashes, and review state. Vault-specific
     fields stay in `vault-seed`.
   - When a lab or publication pipeline was run through a tokenized process,
     `ArtifactProvenance.process` should carry `command`, `args`, `display`,
     optional `cwd`, and optional `packageManager`; `command` remains the
     human-readable compatibility display.
   - The referenced executable is evidence, not payload. The consumer project
     owns and distributes its scripts; Refarm owns the contract that validates
     and describes them.

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

6. **Text quality scoring**
   - Writing vaults and `vault-seed` already prove the value of deterministic
     text scoring for long sentences, draft markers, repeated openings, and
     review reports.
   - Refarm should own the dependency-free scoring contract and JSON report
     shape for generic docs/prose.
   - Submission-specific rubrics, vault dashboards, notebooks, and submission
     language stay in the consumer projects.
   - The first generic lane is `pnpm run text-quality:test`; `pnpm run
     docs:text-quality` applies the scorer to selected Refarm calibration docs
     without making warnings block broader CI yet.

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
5. Later, let `dgk` detect installed Refarm SDK blocks and use them internally
   for advanced flows such as runtime tasks, model-backed curation,
   plugin/package verification, and finish gates.

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
`@refarm.dev/artifact-contract-v1`: it keeps the existing managed artifact
lifecycle and adds task artifact manifests for generated datasets, reports,
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

## 2026-06-24 Amendment — Refarm Supplies UI / Surface / WASM Blocks

This amendment narrows, not deletes, the earlier boundary. The prior text — especially
"What Not To Do" (*"Do not move vault-seed Astro UI, Marimo notebooks into Refarm"*) and
*"healthy duplication at the product edge"* — stays on record above to preserve history.
What changes is the line between **product** and **block**.

**New boundary:**

- Refarm **supplies blocks**: `@refarm.dev/ds` (tokens/style), `@refarm.dev/homestead`
  (shell SDK + UI primitives), `@refarm.dev/dispatch-surface` (cli/tui/web/rpc/http/a2a),
  and the Tractor WASM substrate (ADR-049 / ADR-044) as the common distribution layer for
  lab/site surfaces.
- Consumers **compose product** from those blocks. What stays at the consumer edge is the
  *product/content/config* (PARA vocabulary, onboarding copy, vault-specific dataset names,
  editorial workflow) — not the UI capability itself.
- Still forbidden: moving a consumer's **finished product** (the actual Astro site, the
  actual notebooks) into Refarm. Supplying the blocks that *build* them is now explicitly
  in scope. This resolves the standing inconsistency where the doctrine said "no UI supply"
  while `ds`, `homestead`, and `dispatch-surface` already shipped as UI/surface SDKs.

**Readiness gate (dogfooding):** Refarm is its own first consumer. A block is *supplyable*
only after Refarm consumes it itself (`apps/me`, `apps/refarm`, `farmhand`, `tractor`). If
`apps/refarm` accretes logic that should be a reusable block, that is misfocus — the apps
should be thin consumers that prove the blocks.

**Astro / Marimo convergence:** treat them not as two embedded apps but as two language
surfaces (TS, Python) over one WASM distribution substrate. Refarm should learn WASM
distribution from Marimo (Pyodide) and Astro 7 (Rust toolchain) and provide the shared
substrate, without embedding either app.

## 2026-06-25 Amendment — Consumer-Pulled v0.1.0 Acceleration

The 2026-06-24 boundary still holds: Refarm supplies blocks, `vault-seed`
composes product. The correction is scheduling. `vault-seed` cannot wait for a
fully polished Refarm release if that means continuing to build local versions of
the same blocks that will later be replaced. That duplication is now treated as
v0.1.0 evidence, not as downstream cleanup.

**Rule:** when `vault-seed` needs a Refarm-shaped block, the implementation lane
must include a consumer proof before the block is considered release-ready:

1. Refarm proves the block in its own package/app boundary.
2. Refarm exposes a candidate consumption path: packed package, local workspace
   artifact, generator manifest, or codemod dry-run.
3. `vault-seed` consumes the candidate on a branch without surrendering product
   ownership.
4. The proof records command, fallback, rollback, and any missing Refarm
   semantics.

This makes the `vault-seed` need a force multiplier for v0.1.0:

| Consumer need | Refarm block lane | Why it accelerates v0.1.0 |
| --- | --- | --- |
| Lab/admin visual consistency | `@refarm.dev/ds` + `@refarm.dev/homestead/ssr` | Converts UI duplication into token/SSR conformance evidence. |
| Vault ETL, Lab export, publish receipts | `@refarm.dev/launch-process` + `@refarm.dev/artifact-contract-v1` | Turns `dgk` process boundaries into reusable task/provenance evidence. |
| Credential collection without secret sprawl | `@refarm.dev/silo` collect + later bridge | Proves namespace separation across app and consumer. |
| Telegram outbox/inbox and channel state | `@refarm.dev/channel-policy-v1`: destinations, rate limits, receipts, dry-run, review gates | Lets `vault-seed` keep Telegram UX while Refarm gains reusable channel evidence for dispatch/farmhand surfaces. |
| Generated vaults instead of template drift | vault-seed generator + codemod registry | Makes boilerplate reduction a tested Refarm capability. |
| Skill/agent compatibility | skill runtime activation + Pi/WASM/UI proof | Starts only when a real invocation surface exists, but is planned from consumer pressure. |

**2026-06-26 UI consumer packet:** `@refarm.dev/ds` now exposes the Lab-proven
`verde-jardim` light mode, and `@refarm.dev/homestead-ssr` gives `vault-seed` a
build-free SSR tier without pulling the full Homestead SDK dependency closure.
The current handoff lives under `.refarm/handoff/vault-seed/2026-06-28/`:

- `refarm.dev-ds-0.1.0.tgz`
  (`sha256 f2a2a74de322717af827a3f2541146fd54757bc3746fe7cd8e33ffb03620df11`);
- `refarm.dev-homestead-ssr-0.1.0.tgz`
  (`sha256 e7203aa919dd13b03c19f8fa675dda37fdf2843d4c5ab0f2598bedc130d1d015`).

A scratch consumer proof validated the intended adoption shape without
committing into `vault-seed`: install both tarballs, override the unpublished
transitive `@refarm.dev/ds` dependency to the local tarball, import
`@refarm.dev/homestead-ssr`, and render a `verde-jardim` shell. The proof also
confirmed DS classes and theme CSS references, and confirmed
`@refarm.dev/homestead` is absent from `node_modules`. The official consumer
checkout still needs to assimilate/review that packet. Consumer-local semantic
tokens remain fallback-only for raw Marimo sessions.

**2026-06-26 process provenance packet:** `@refarm.dev/launch-process` now proves
its runner-style process specs can be embedded directly in
`@refarm.dev/artifact-contract-v1` task artifact provenance without
shell-splitting. The package is the build-free `vault-seed-ready` leaf;
`@refarm.dev/cli/launch-process` stays as a compatibility re-export. The
`vault-seed-ready` publish dry-run passes with this leaf included and the full
CLI closure excluded. Candidate tarball:
`.refarm/handoff/vault-seed/2026-06-28/refarm.dev-launch-process-0.1.0.tgz`
(`sha256 83856b177ef78e9e417fc985ecd7bf26a6ca0568209d8d75dc679be265618f9b`).
The official `vault-seed` proof remains downstream: `@aretw0/dgk-runner` or
`@aretw0/dgk-cli` should import
`@refarm.dev/launch-process` internally while keeping the exported
`run(cmd, args, opts)` API and command UX local, then emit a task artifact
manifest that references the tokenized process boundary.

**2026-06-26 artifact/Lab evidence packet:** `@refarm.dev/artifact-contract-v1`
now includes a Refarm-side fixture for `vault-seed` Lab datasets, publication
outbox manifests, and notebook snapshots using generic roles plus labels instead
of upstreaming notebook UX or vault schema. Candidate tarball:
`.refarm/handoff/vault-seed/2026-06-28/refarm.dev-artifact-contract-v1-0.1.0.tgz`
(`sha256 75c6c0f746435ae6b91ff009178b2a5f367e020f616eda33a3e11f54dd1caa08`).
Tarball contents are limited to `dist/`, `package.json`, `README.md`, and
`LICENSE`. The official proof remains downstream: `vault-seed` should emit
`refarm.task-artifacts.v1` manifests from its Lab/outbox/notebook producers.

**2026-06-26 channel-policy packet:** `@refarm.dev/channel-policy-v1` now has a
consumer-pulled handoff for Telegram/outbox evidence without moving provider API
behavior, Markdown formatting, or `dgk outbox/inbox` UX upstream. Candidate
tarball:
`.refarm/handoff/vault-seed/2026-06-28/refarm.dev-channel-policy-v1-0.1.0.tgz`
(`sha256 f524fd8a770aa2efb050e5dccdfa809bf1f71f397baddf149a9fd5e962f2bca8`).
Tarball contents are limited to `dist/`, `package.json`, `README.md`, and
`LICENSE`. The official proof remains downstream: the `vault-seed` Telegram
adapter should emit `refarm.channel-delivery-envelope.v1` while keeping provider
calls and user-facing command semantics local.

**2026-06-28 full `vault-seed-ready` handoff:** the local handoff directory now
contains a tarball for every package in the 10-package release-policy selection:

| Package | Tarball | SHA256 |
| --- | --- | --- |
| `@refarm.dev/artifact-contract-v1` | `refarm.dev-artifact-contract-v1-0.1.0.tgz` | `75c6c0f746435ae6b91ff009178b2a5f367e020f616eda33a3e11f54dd1caa08` |
| `@refarm.dev/channel-policy-v1` | `refarm.dev-channel-policy-v1-0.1.0.tgz` | `f524fd8a770aa2efb050e5dccdfa809bf1f71f397baddf149a9fd5e962f2bca8` |
| `@refarm.dev/effort-contract-v1` | `refarm.dev-effort-contract-v1-0.1.0.tgz` | `35ae608bec8bff652473efcd19a76d843f8fe91aaa7956e244a51914be396bfb` |
| `@refarm.dev/launch-process` | `refarm.dev-launch-process-0.1.0.tgz` | `83856b177ef78e9e417fc985ecd7bf26a6ca0568209d8d75dc679be265618f9b` |
| `@refarm.dev/release-engine` | `refarm.dev-release-engine-0.1.0.tgz` | `8f45312c3b1881711176a092a3d598c06fbf1cd353ec4d96a31b83df2e70178c` |
| `@refarm.dev/ds` | `refarm.dev-ds-0.1.0.tgz` | `f2a2a74de322717af827a3f2541146fd54757bc3746fe7cd8e33ffb03620df11` |
| `@refarm.dev/heartwood` | `refarm.dev-heartwood-0.1.0.tgz` | `003df0efccdcd4367a08dea8f975f7dfd1141b54f45595dd441b23088ba539c5` |
| `@refarm.dev/dispatch-surface` | `refarm.dev-dispatch-surface-0.1.0.tgz` | `fcb135b1ba9a082d2de5c01bc94987df4540a1b9097a0e17da3d8968e8517bce` |
| `@refarm.dev/homestead-ssr` | `refarm.dev-homestead-ssr-0.1.0.tgz` | `e7203aa919dd13b03c19f8fa675dda37fdf2843d4c5ab0f2598bedc130d1d015` |
| `@refarm.dev/silo` | `refarm.dev-silo-0.1.0.tgz` | `91ba2f208939eb4c8fb02d161ecaadbc2d75e83aed44fff00306bf4951e4fecb` |

Pre-publication consumers should install these from the local handoff and
override unpublished workspace dependencies to matching tarballs where needed;
for example, `@refarm.dev/dispatch-surface` depends on
`@refarm.dev/effort-contract-v1`, and `@refarm.dev/silo` depends on
`@refarm.dev/heartwood`.

As of 2026-06-28, `pnpm --silent run release:vault-seed:handoff -- --pack --json`
materializes the tarballs sequentially and emits the same package acceptance
summary exposed by the release plan. The current packet reports
`acceptance.status: "accepted"`, 10 packages, 4 required gates, 24 required
checks, one publish provider, and `manualApprovalRequired: true`. The Markdown
form prints the same acceptance line before the tarball table, so a consumer
handoff can verify readiness without reinterpreting the full release plan.

### Additional Assimilation Matrix

The downstream audit shows more Refarm-shaped work than the first block list. Use
this matrix before adding more `vault-seed`-local infrastructure:

| `vault-seed` responsibility today | Refarm assimilation target | Posture |
| --- | --- | --- |
| `scripts/prepare_publication_outbox.mjs`, `.dgk/outbox-publicacao.json`, Lab outbox notebook | Artifact/provenance + channel policy evidence | Activate with 8b; vault-specific frontmatter stays downstream. |
| `scripts/prepare_lab_datasets.mjs`, notebook export/check/pair helpers, Lab manifest | Artifact contract + WASM/lab distribution substrate | Candidate after artifact proof; Marimo UX stays downstream. |
| `scripts/smoke_template.js`, initialize reset, generated-vault smoke | Vault generator + codemod registry | Active item 9a/9b. |
| `release_package_smoke`, version/integrity/lockfile template checks | `@refarm.dev/release-engine` + package acceptance summary | Candidate block; DGK package names stay downstream. |
| `actions:pins`, substrate/devcontainer/template contract checks | `@refarm.dev/health` / environment substrate checks | Candidate block when rules are consumer-neutral. |
| text scoring and presentation quality scripts | Refarm text-quality contract/config | Already a Refarm lane; rubrics and dashboards stay downstream. |
| wiki links, callouts, image/slug conventions | Content transform contract only if another consumer repeats it | Hold at product edge for now; Astro rendering remains `vault-seed`. |
| Obsidian/VS Code launchers, PARA routes, note templates | Product-local vault UX | Keep downstream. |

### Roadmap Assimilation Matrix

The rest of the `vault-seed` roadmap is mostly Refarm supply pressure. Assimilate
the neutral substrate early so the vault does not spend another release building
local stand-ins:

| Roadmap item | Refarm supply lane | Keep in `vault-seed` |
| --- | --- | --- |
| v0.5 source IaC: `lab.sources.json`, `ExtractionProfile`, cache/staging | `source:v1` adapters, source profile contract, artifact/provenance, retention policy | source catalog, Python profile bodies, PARA target semantics |
| v0.5 `target: "auto"` classification | model/task classification contract with auditable artifact evidence | taxonomy, review workflow, note placement rules |
| v0.5/v0.6 multi-channel publishing: Mastodon, Bluesky, Telegram, Nostr | channel policy/evidence, `silo` identity namespaces, receipt/idempotency/rate-limit shapes | provider API adapters, copy formatting, inbox/outbox CLI UX |
| v0.6 Nostr kind 30023 | identity/channel proof and signed receipt shape | relay choices, notebook UX, article conventions |
| v0.7 Refarm primitive adoption | item 8 bridges with candidate packages, codemods, fallback wrappers | `@aretw0/dgk-*` product packages and migration compatibility |
| Lab WASM helpers, feed/OpenGraph readers, refresh workflows | WASM substrate, HTTP/source readers, artifact snapshot contract | Marimo notebooks, dataset examples, visual exploration |
| `dgk publish workspace` and custom distributions | generator/codemod registry, release-engine, package acceptance policy | distribution identity, Obsidian/Foam defaults, user-facing template docs |
| OKF/JSON-LD/semantic graph export | knowledge/content manifest contract and graph artifact envelope | OKF-specific mapping, editorial governance, publication copy |
| DGK changelog as publishable content | release-engine emits release-note artifact; channel policy handles delivery evidence | final prose, frontmatter defaults, channel selection |
| local data lifecycle beyond git: SQLite, data repo, snapshot compaction | storage/materialization/retention policy attached to artifact contracts | backend choice for each vault and migration timing |
| `vault-publish`, `vault-inbox`, `vault-changelog` skills | Refarm skill runtime activation over source/channel/release primitives | SKILL.md copy, DGK-specific skill packaging |

Treat this as the pre-implementation checklist for future `vault-seed` roadmap work. A slice that
fits a Refarm supply lane should start with a Refarm spec/codemod/generator proof, then let
`vault-seed` consume it as candidate infrastructure. A slice that is vocabulary, editorial flow,
provider-specific API code, or vault UX stays downstream and emits neutral evidence only.

The product boundary remains strict:

- no Refarm dependency is required for an already-generated vault;
- no vault content, route copy, notebook UX, or PARA convention moves upstream;
- no Telegram Bot API behavior, Markdown formatting, inbox filenames, or `dgk outbox/inbox` UX
  moves upstream;
- no package is promoted only because one consumer branch compiles;
- every consumer-pulled exception must either add a Refarm dogfood follow-up or
  stay marked as a candidate.

See [`ECOSYSTEM_SUPPLY_MAP.md`](./ECOSYSTEM_SUPPLY_MAP.md) for the full supply map,
readiness gate, and migration order.
