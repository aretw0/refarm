# Spec: records:v1 YAML-LD Codec (candidate)

**Status:** IMPLEMENTED CANDIDATE — `@refarm.dev/records-contract-v1/yaml`; second-consumer proof
closed in `vault-seed`, promotion remains tied to the release lane. Consumer pressure from
YAML-frontmatter vault flows.
**Authors:** Arthur Silva, Claude
**Date:** 2026-06-30
**Related:** `packages/records-contract-v1` (`records:v1`, JSON-LD model), `packages/surveyor`
(JSON-LD graph consumer), `docs/ECOSYSTEM_SUPPLY_MAP.md` (knowledge/content row), ADR-010 (JSON-LD
evolution), ADR-077 (forward-safe envelope lesson)

---

## Context & Motivation

`records:v1` defines a **JSON-LD** record model (`@context`, `@type`, fields, relations). But a large
class of consumers author records as **YAML front matter** — Markdown vaults (Obsidian/Foam), docs
sites, any note-first tool. **YAML-LD** is exactly this: a YAML serialization of the JSON-LD data
model. For those consumers, a note's front matter *is* the record, if it can be read as YAML-LD and
normalized into a `records:v1` record.

Today each consumer writes that normalization by hand (e.g. a downstream vault projects
`front matter → records:v1`). The **mechanism** — parse YAML-LD, map to the `records:v1` envelope,
serialize back, preserve unknown keys — is the same for every YAML-native consumer. That is a generic
capability; only the **conventions** (which front-matter keys map to which fields, the vocabulary)
are product/config and stay downstream.

## Decision (proposed, proof-gated)

A **YAML-LD codec for `records:v1`** — implemented as
`@refarm.dev/records-contract-v1/yaml` — that:

- **reads** YAML-LD front matter (or a YAML document) into a `records:v1` record (`@type`/`@context`
  aware; unknown keys preserved per ADR-077);
- **writes** a `records:v1` record back to YAML-LD front matter;
- is **forward-safe**: higher `schemaVersion` / unknown fields round-trip without loss.

It does **not** own:

- the front-matter **key conventions** (which keys → which fields) — consumer config;
- the **vocabulary** (`@type` semantics, a vault's own `@context` extension) — consumer config;
- note bodies, PARA placement, or editorial rules — downstream product.

This keeps the model (JSON-LD) and the codec (generic) in Refarm, and the conventions/vocabulary in
the consumer, exactly like `source:v1` owns acquisition while the target selectors stay downstream.

## Consumer pressure & gate

First pressure: a downstream YAML-frontmatter vault (Obsidian-native) that projects notes → `records:v1`
and would otherwise re-implement the YAML-LD ↔ record normalization.

Second-consumer signal, 2026-07-01: `vault-seed` round-tripped its `records:v1` projection through
`recordToYamlLdObject` / `recordFromYamlLdObject` and its front-matter bridge. That proof also
confirmed the parse behavior for lean projections: the codec completes the record by stamping
`schemaVersion` and computing `contentHash`.

The codec remains a **candidate** until release-lane promotion, but the second-consumer gate is no
longer the blocker. Product vocabulary, key conventions, note bodies, and editorial semantics still
stay downstream.

## First proof shape

- a fixture note front matter (YAML-LD) → codec → a valid `records:v1` record (conformance);
- round-trip: record → YAML-LD → record is stable;
- forward-safety: a front matter with an unknown key / higher `schemaVersion` round-trips without loss;
- no vocabulary or key convention baked into the codec (a config supplies the mapping).

## Non-Goals

- No front-matter key conventions or vocabulary in the codec.
- No Markdown body parsing / note rendering.
- No new data model — YAML-LD is the JSON-LD `records:v1` model in YAML, not a second model.
