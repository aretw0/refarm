# Plan: Work 3 Requirements Supply Activation

> Spec: `specs/features/2026-06-30-work-3-requirements-supply-activation.md`.
> Goal: make Refarm supply the neutral blocks a requirements-vault POC needs,
> while keeping private target logic downstream and preserving the publication
> gates.

## Task 1 - Enrichment Contract Slice

- [x] Draft `enrichment:v1` with provider identity, input selectors, dry-run/apply
  mode, deterministic result summaries, diagnostics, and provenance.
- [x] Add a sanitized reference fixture that enriches local records without network
  access.
- [x] Gate: no private registry, identifier vocabulary, or vault-specific tag prefix
  in the contract.

Implemented as `@refarm.dev/enrichment-contract-v1` with types, a deterministic
fixture provider, conformance tests, and package-local lint/type/build checks.
It remains proof-gated and is not in release policy until a downstream proof
uses the package without moving private providers into Refarm.

## Task 2 - Authenticated Web Source Adapter Design

- [x] Extend the source-adapter activation packet with an authenticated web capture
  trigger.
- [x] Decide whether the additive source kind belongs directly in `source:v1` or in
  a web-specific package wrapper that emits `source:v1`-compatible snapshots.
- [x] Include session evidence, pacing policy, cache identity, offline replay, and
  redaction rules.
- [x] Gate: discovery of accessible systems and source-specific selectors remain
  downstream adapters.

Implemented as `@refarm.dev/source-web`: an authenticated-web fixture adapter
that materializes redacted, replayable local snapshots through `source:v1`.
`source-contract-v1` remains unchanged; web session/cache/pacing/redaction
details live in package provenance and real login/selectors stay downstream.

## Task 3 - Knowledge/Content Manifest

- [x] Specify a graph/content envelope for records, sections, relations,
  attachments, source references, hashes, and review state.
- [x] Reuse `artifact-contract-v1` provenance and selection concepts instead of
  creating a vault schema.
- [x] Gate: the manifest must work for sanitized requirement-like fixtures and not
  require consumer vocabulary.

Implemented as `@refarm.dev/records-contract-v1` with a sanitized fixture
manifest, referential-integrity validation, stable content hashes, open
vocabulary, and forward-safe upcast. It remains proof-gated and out of
release-policy until downstream proof and composition evidence exist.

## Task 4 - Diagnostics Gate

- [x] Define the first cheap preflight for ingestion work: environment pressure, source
  coverage, cache completeness, drift, and review-state validation.
- [x] Prefer package-local fixture checks over browser-heavy end-to-end tests.
- [x] Gate: an operator can tell whether to allow, degrade, serialize, or refuse the
  ingestion before launching expensive work.

Initial coverage is `requirements:supply:composition:test`, a sanitized
composition proof in `scripts/ci` that builds `@refarm.dev/health`,
`@refarm.dev/enrichment-contract-v1`, and `@refarm.dev/records-contract-v1`,
then validates environment pressure, source coverage, review-state counts,
deterministic enrichment, record hash drift, and final `records:v1`
validation. It intentionally avoids browser automation, private selectors,
release-policy promotion, and consumer vocabulary.

## Task 5 - Consumer Handoff Planning

- Add release-policy profiles only after package slices exist and have checks.
- Use local handoff for consumer-pulled proofs before public npm publication.
- Record fallback paths so downstream POCs can keep moving if a Refarm leaf is
  not yet selected.

## Non-Goal

Do not implement the private POC, source login, target discovery, or enrichment
provider in Refarm.
