# Spec: Consumer Bridges Activation (Roadmap Item 8)

**Status:** DRAFT — deferred activation packet
**Authors:** Arthur Silva
**Date:** 2026-06-25
**Related:** `docs/VAULT_SEED_CONVERGENCE.md`, `docs/CONVERGENCE_ROADMAP.md` item 8,
`specs/features/2026-06-25-silo-collection-contract.md`

---

## Context & Motivation

Item 8 covers consumer bridges from `vault-seed`/`dgk` into Refarm packages. These should not be
promoted merely because code exists downstream. They activate only when a second consumer proves
the primitive is consumer-neutral.

## Bridge Split

| Bridge | Trigger | First spec must prove |
|---|---|---|
| 8a `vault-seed` `silo.js` -> `@refarm.dev/silo` | `silo` collect exists and another consumer needs scoped secret storage | model/runtime/channel/publishing namespaces remain separate |
| 8b `dgk-channels` -> `contacts` + `rate-limiter` | another publishing or messaging consumer needs contact topology and limits | contacts/rate limits are not Telegram- or DGK-specific |
| 8c `dgk-runner` -> `@refarm.dev/cli/launch-process` | another CLI needs the same process launch lifecycle | helper is independent of DGK command names and vault paths |

## Rules

- One bridge per branch.
- One feature spec and plan per bridge.
- The downstream consumer remains canonical for product UX.
- Refarm owns only the neutral primitive.

## Verification

Each bridge spec must include:

1. two consumers;
2. the neutral API surface;
3. the downstream adapter;
4. migration/fallback path;
5. package acceptance and consumer proof.

## Out of Scope

- Bulk migration of all `dgk` internals.
- Merging model/runtime secrets with publishing-channel credentials.
- Rebranding `dgk` packages under `@refarm.dev`.
