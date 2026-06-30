# Spec: Work 3 Requirements Supply Activation

**Status:** DRAFT - activation packet, source-web/enrichment/records package slices implemented, cheap composition proof and proof-gated release-policy profiles added
**Date:** 2026-06-30
**Related:** `docs/ECOSYSTEM_SUPPLY_MAP.md`,
`specs/features/2026-06-24-source-contract-v1.md`,
`specs/features/2026-06-25-source-adapter-activation.md`,
`packages/artifact-contract-v1`, `@refarm.dev/health/environment-pressure`

## Context

A downstream requirements-vault proof needs to demonstrate a knowledge operator
starting from a vault, collecting requirements from an authenticated web system,
rendering auditable notes, enriching records by external keys, and exposing a
small review surface.

This is consumer pressure, not permission to import the consumer's domain into
Refarm. Refarm should only absorb the neutral substrate that another vault or
operator workflow could reuse. The downstream proof keeps the source-specific
login, discovery, selectors, vocabulary, and presentation story.

## Decision

Activate the requirements-vault supply lane as four neutral Refarm surfaces:

1. **Authenticated web source adapter candidate**: a `source:v1` adapter family
   that can materialize a stable local snapshot from an authenticated web source.
   The adapter owns session lifecycle evidence, pacing, cache provenance, and
   offline replay hooks. It does not own target discovery or source-specific
   selectors.
2. **`enrichment:v1` contract candidate**: a provider contract for deterministic
   enrichment over records or note files. The contract owns rule/provider
   identity, input selection, dry-run/apply results, diagnostics, and provenance.
   It does not own any external registry, private lookup, or local vocabulary.
3. **Knowledge/content manifest candidate**: a graph/content envelope for
   requirement-like records, sections, relations, attachments, source references,
   hashes, and review state. It should attach to artifact/provenance contracts
   instead of becoming a vault-specific schema.
4. **Cheap diagnostics gate**: requirements ingestion must use low-cost pressure,
   coverage, drift, and policy checks before running expensive browser or render
   work. `@refarm.dev/health/environment-pressure` and artifact/source
   diagnostics are the expected building blocks.

The activation is intentionally additive. No public npm release follows from
this spec alone. The first outcome should be a local handoff-ready candidate
when package slices and downstream proofs exist.

## Boundary

Refarm owns:

- versioned contracts, conformance runners, reference fixtures, and validators;
- source/cache/artifact/enrichment provenance shapes;
- release-policy and local handoff metadata for consumer-pulled packages;
- generic diagnostics that prevent expensive ingestion from running blindly.

Consumer vaults own:

- PARA vocabulary, note placement, editorial workflow, and Obsidian/Foam UX;
- ETL profiles and renderer choices that are specific to the vault product;
- Astro/admin views composed from Refarm UI primitives;
- CLI labels and command copy.

Private downstream proofs own:

- accessible-system discovery;
- source login strategy, selectors, aliases, and pacing values for the real
  target;
- private enrichment providers and domain vocabulary;
- any internal distribution wrapper for those adapters.

## Activation Order

1. Write package-level design for `enrichment:v1` first. It is the smallest new
   contract and has no browser/runtime dependency. Initial package slice is
   implemented in `@refarm.dev/enrichment-contract-v1` with a deterministic
   fixture provider and conformance suite; release promotion remains gated by a
   downstream proof.
2. Extend the source-adapter activation packet for authenticated web capture.
   Implemented as `@refarm.dev/source-web`: a web-specific adapter that
   materializes redacted, replayable local snapshots through `source:v1`.
   `source-contract-v1` remains unchanged; session/cache/pacing/redaction
   provenance is package-owned and real login/selectors stay downstream.
3. Specify the knowledge/content manifest after the enrichment and source
   evidence shapes are concrete enough to reference. Initial package slice is
   implemented in `@refarm.dev/records-contract-v1` with sanitized fixture
   validation, relation integrity, stable content hashes, and forward-safe
   upcast; release promotion remains gated by downstream proof and composition
   evidence.
4. Add a cheap sanitized composition proof before any browser-heavy proof.
   `requirements:supply:composition:test` builds `@refarm.dev/health`,
   `@refarm.dev/source-web`, `@refarm.dev/enrichment-contract-v1`, and
   `@refarm.dev/records-contract-v1`, then checks environment pressure,
   authenticated-web fixture replay, source coverage, review-state counts,
   deterministic enrichment, hash drift, final `records:v1` validation, and a
   sanitized `artifact:v1` manifest with review report. The proof does not add
   release-policy, private selectors, login flows, or consumer vocabulary.
5. Only then add release-policy entries or `vault-seed-ready` handoff metadata,
   and only for package leaves with checks and a named downstream proof.
   Current implementation registers `@refarm.dev/source-web`,
   `@refarm.dev/enrichment-contract-v1`, and `@refarm.dev/records-contract-v1`
   as release-profiled `requirements-supply` candidates with package checks,
   `boundary-review`, and `candidate-hold`. They are intentionally not selected
   for `vault-seed-ready` until the downstream checkout records a consumer pull
   proof through the local handoff lane.

## First Proof Shape

The first proof should be synthetic or sanitized:

- a local fixture source with login/session evidence but no private target;
- a small set of requirement-like records with source references and relations;
- one enrichment provider that adds neutral tags or fields from deterministic
  local data;
- diagnostics for coverage, drift, and environment pressure;
- an artifact manifest that records the produced notes, graph/content manifest,
  and review report.

The real downstream proof may use private adapters, but Refarm artifacts must be
able to pass with sanitized fixtures.

## Non-Goals

- Do not generalize accessible-system discovery. It is operator- and target-
  specific.
- Do not move private login flows, selectors, or registry lookups into Refarm.
- Do not publish the reference agent runtime as a side effect of this work.
- Do not replace a consumer vault's editorial model with Refarm vocabulary.
- Do not run browser-heavy or corpus-wide tests as the default readiness check.

## Verification

Each eventual package slice must provide:

1. package-local unit tests or fixture validation;
2. conformance or validator output suitable for CI;
3. release-policy profile entries only after package checks exist;
4. a downstream proof that consumes the package through local handoff or an
   equivalent candidate channel;
5. explicit fallback behavior when the Refarm package is unavailable.

Current composition proof:

- `pnpm run requirements:supply:composition:test`

Current handoff planning proof:

- release-policy profiles exist for the three requirements-supply leaves;
- `pnpm run release:boundary:audit` blocks missing hold tags or premature
  `vault-seed-ready` selection;
- downstream POCs may keep private login, selectors, and enrichment providers
  outside Refarm while wrapping the profiled packages when available.
