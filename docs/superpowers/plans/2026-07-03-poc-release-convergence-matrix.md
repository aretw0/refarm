# PoC Release Convergence Matrix

> Status: working release map for turning three private demonstration pressures
> into generic Refarm blocks, downstream vault-seed adoption, and consumer-owned
> PoC surfaces. This file deliberately avoids private repo names, institutional
> draft wording, local paths, and proposal-specific claims.

## Core Boundary

Refarm owns generic substrate:

- contracts, manifests, policy decisions, capability checks, runtime gates;
- source and artifact evidence handoffs;
- local-first storage, identity, credential, sync, and content primitives;
- plugin, skill, agent, and white-label CLI/TUI/Web affordances;
- validation packets that a consumer can use without adopting Refarm branding.

`vault-seed` is the first product spokesperson:

- it can expose `dgk-*` workflows while consuming Refarm blocks underneath;
- generic `dgk-*` behavior should be hoisted back into Refarm when it becomes a
  reusable block;
- vault-local product language, note UX, publication flow, Lab conventions, and
  downstream commands stay with `vault-seed`.

`agents-lab` is the agent/skill downstream pressure:

- it can keep product-specific Pi/agent conventions;
- Refarm should absorb only the portable engine patterns: skill packaging,
  invocation contracts, review packets, source evidence, policy, and operator
  loops.

Private PoCs own the last-mile specificity:

- institutional naming, login flows, real providers, screenshots, final copy,
  slide decks, and submission framing;
- any integration that only exists to demonstrate a specific external context;
- any evidence that should not become a reusable package or public handoff.

## Demonstration Tracks

| Track | Demonstration scene | Refarm should provide | vault-seed may wrap | Consumer-owned remainder |
| --- | --- | --- | --- | --- |
| T1 | Persona installs a white-label CLI powered by Refarm, installs an agent/skill/plugin, and develops or rehearses a small plugin, skill, or app. | Plugin manifest, capability policy, install/review packet, runtime descriptor evidence, source evidence, task artifacts, isolated rehearsal, coding-agent handoff, CLI/TUI shell. | Product CLI command names, vault-friendly install/help text, skill packaging surface, guided local workflow. | The actual branded demo plugin/app, final screenshots, narrative, and any private distribution framing. |
| T2 | Persona runs a local-first web platform with a simple command and manages a personal/provider integration, credential, document, or authorization flow. | Identity, credentials, storage, consent/authorization receipts, revocation/audit trail, local surface manifest, DS quality checks, provider-neutral connectors. | Local vault onboarding, `sow`/credential wizard semantics, local admin panel, channel/provider vocabulary. | Specific provider choice, UI screenshots, personal-document example, writing frame, and usability polish beyond generic contracts. |
| T3 | Persona uses a white-label CLI/vault flow to assemble a governed note/requirements box from discovered external work items and enriched records. | Source ingestion, records, enrichment, content projection, artifact manifests, publication preflight, selector queries, quality checks, local evidence index. | Vault commands, note schemas, Lab export, Obsidian/Astro presentation, publication outbox. | Specific login/scraper adapter, domain taxonomy, external system details, real-work screenshots, final proof packaging. |

## Non-Negotiable Demo Rule

Do not make a demonstration depend on developing the very plugin or primitive it
is supposed to show. The scene can show installation, review, isolated rehearsal,
or a small adjacent change, but the required plugin/skill/app must already exist
as a prepared artifact before the demo run.

This keeps the PoC deterministic:

- the demo proves the workflow, not the luck of a live coding session;
- screenshots can be regenerated;
- evidence can be sanitized;
- consumers can replace branding without changing the underlying substrate.

## What Needs To Leave Hold Now

### T1: Governed Agent And Extension Flow

Release-critical generic blocks:

- white-label CLI command envelope for `install`, `doctor`, `check`, `review`,
  `run`, and `handoff`;
- plugin/skill install plan with explicit policy decision and denied-capability
  receipt;
- temporary workspace rehearsal packet for coding-agent changes;
- runtime descriptor/install evidence that can be shown without naming Refarm;
- artifact index for generated review evidence.

Existing pressure:

- `validations/extension-sandbox-poc`;
- `agent-demo:release-proof`;
- `agent:release-proof`;
- native skill smokes from `agents-lab` and `vault-seed`;
- runtime descriptor release smoke.

### T2: Local-First Personal Platform

Release-critical generic blocks:

- local-first local surface launched by CLI;
- credentials/secret store vocabulary that can be white-labeled;
- provider-neutral setup wizard shape;
- authorization receipt, selective disclosure, revocation, and audit evidence;
- DS quality adapter and compact local admin UI checks.

Existing pressure:

- `validations/citizen-data-wallet-poc`;
- `@refarm.dev/ds/quality-checker`;
- `@refarm.dev/silo`, `credentials:v1`, `identity:v1`, `storage:v1`;
- vault-seed `sow`, `serve`, and channel setup patterns.

### T3: Governed Note And Requirements Box

Release-critical generic blocks:

- markdown/content projection into records;
- source capture and enrichment pipeline;
- artifact manifest selectors for lab/publication consumers;
- publication preflight and human review gates;
- vault-neutral quality checks for note/readiness output.

Existing pressure:

- `validations/governed-note-box-poc`;
- `artifact-contract-v1` selectors;
- `source:v1`, `records:v1`, `enrichment:v1`;
- vault-seed note, ETL, Lab, and publication conventions.

## Release Ordering

1. Keep `vault-seed-ready` handoff green.
2. Finish the generic quality layer already started: `ds-lint` remains the
   engine; `quality:v1` is the consumer adapter.
3. Add content projection as the next high-leverage block for T2/T3 and
   vault-seed.
4. Harden the agent/plugin review packet for T1, using existing validation
   evidence before expanding runtime scope.
5. Add a minimal local surface proof only after the CLI/contract evidence is
   stable enough that web rendering is just one adapter.
6. Let `vault-seed` consume the handoff and prove which `dgk-*` pieces can be
   thinned because Refarm now owns the generic primitive.

## Success Definition

The release is converging when each track can produce a sanitized packet with:

- one command entrypoint;
- one prepared artifact or plugin/skill/app;
- one generated evidence directory;
- one reader-facing scorecard or matrix;
- one explicit non-claim section;
- no Refarm branding required in the consumer-facing scene;
- no private context copied into Refarm.

The result should let people use Refarm without knowing its name, while Refarm
still receives the hardening pressure from real downstream use.
