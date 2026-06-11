# PoC Validation Pressure

Status: calibration note for using local external drafts as pressure without
coupling Refarm to that writing workflow.

The local external vault is read-only evidence. It can reveal which claims need
a small, reproducible proof, but Refarm must keep the proof generic, synthetic,
and useful beyond those drafts.

## Boundary

- Do not write generated configuration, reports, or drafts into the work vault.
- Do not make external draft text a source file for Refarm.
- Do not copy employer-specific wording, local paths, or submission artifacts
  into Refarm validations.
- Promote only reusable primitives, runnable validations, and sanitized docs.

## Current Read

The draft plan separates three demonstrable ideas:

| Draft pressure | Refarm-facing proof | Current state |
| --- | --- | --- |
| Extension host with sandboxed capabilities | Plugin/WASM host, manifest integrity, lifecycle events, strict and tolerant policy modes. | Covered by `validations/extension-sandbox-poc/` as a synthetic lifecycle/policy proof; real WASM/runtime substrate remains covered by existing package tests and heavier validations. |
| Citizen data wallet and granular authorization | Local identity, synthetic attributes, scoped request, signed authorization, selective presentation, revocation, audit trail. | Implemented as `validations/citizen-data-wallet-poc/` with deterministic artifacts and `refarm.task-artefacts.v1` manifest. |
| Governed note box / digital garden | Ingestion, metadata preservation, MOCs, publication/lab snapshots, validation, human review before publish. | Proven mostly by `vault-seed` as external consumer. Refarm should harden artifact/provenance, external workspace health, and process handoff primitives. |

The important design point is that the proofs are not submission deliverables.
They are generic validation pressure for Refarm's daily-driver substrate.

## Theme 1: Extension Sandbox

Useful Refarm primitives already exist:

- `@refarm.dev/plugin-manifest` for manifest schema and integrity surfaces.
- Tractor/Tractor TS plugin hosts for WASM/module execution boundaries.
- Browser runtime descriptor integrity, provenance, and revocation paths.
- Capability contracts such as `storage:v1`, `sync:v1`, and `identity:v1`.

Current validation:

- `validations/extension-sandbox-poc/extension-sandbox-poc.mjs`
- `validations/extension-sandbox-poc/extension-sandbox-poc.test.mjs`
- `validations/extension-sandbox-poc/fixtures/expected/task-artefacts.json`

What it proves:

- a benign extension manifest validates and completes `setup -> ingest ->
  teardown`;
- a denied extension is blocked when it requires a capability outside the grant;
- `warn+continue` isolates a failing extension and lets the host continue;
- `fail-fast` aborts the host flow on extension failure;
- lifecycle and policy observations are exported as deterministic JSON/Markdown;
- generated outputs are described by a `refarm.task-artefacts.v1` manifest.

What it deliberately does not prove:

- real WebAssembly execution;
- browser runtime descriptor installation;
- production plugin governance;
- performance of a real host or plugin.

Next useful Refarm step:

1. Connect this report shape to a real plugin lifecycle smoke once the cheapest
   reproducible path is stable across Linux, macOS, and Windows.
2. Keep `@refarm.dev/artefact-contract-v1` in the contract smoke gate and run
   `pnpm run task-artefacts:check` whenever expected reports or manifests
   change.

Success signal:

- The validation can answer whether a host loaded a plugin, respected declared
  capability boundaries, recorded lifecycle events, and handled a denied or
  failing plugin according to policy.

## Theme 2: Citizen Data Wallet

Current validation:

- `validations/citizen-data-wallet-poc/wallet-poc.mjs`
- `validations/citizen-data-wallet-poc/wallet-poc.test.mjs`
- `validations/citizen-data-wallet-poc/fixtures/expected/task-artefacts.json`

What it proves:

- synthetic local identity;
- synthetic issuer attributes;
- service request with purpose, expiration, requested attributes, and
  justification;
- signed authorization receipt;
- selective presentation;
- tamper detection;
- revocation event;
- deterministic JSON/Markdown outputs;
- task artefact manifest with media type, SHA-256 hashes, review state, and
  provenance.

What it deliberately does not prove:

- EUDI wallet interoperability;
- W3C VC or OpenID4VP/OpenID4VCI conformance;
- production UX/accessibility;
- real public service integration;
- multi-device sync.

Next useful Refarm steps:

1. Keep `pnpm run task-artefacts:check` green whenever expected reports or
   manifests change.
2. Optionally persist the authorization receipt through a storage adapter.
3. Add a small consent-text review checklist that remains synthetic and
   non-product.

## Theme 3: Governed Note Box

The strongest pressure comes from `vault-seed`, not from adding note UX to
Refarm.

Refarm should own:

- task artefact and provenance contracts;
- external workspace health and policy suggestion;
- structured process handoffs;
- optional skill/package compatibility adapters;
- validation gates that can be consumed by project-local CLIs.

`vault-seed` should keep owning:

- Astro site UX;
- Marimo notebooks and Lab conventions;
- Obsidian/PARA onboarding;
- vault-local `dgk` commands;
- note schemas, publication outbox, and editorial workflow.

Next useful Refarm step:

1. Let a downstream lab consume a `refarm.task-artefacts.v1` manifest instead of
   hard-coding output file names.
2. Keep the consumer-specific mapping in `vault-seed`, not in Refarm.

## Operating Rule

When a draft asks for proof, implement the proof in Refarm only if it improves a
general primitive or validation. If the work is product-specific to a vault,
keep it in `vault-seed`. If the work is submission-specific, keep it out of both
and use the read-only vault only as evidence.
