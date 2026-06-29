# Spec: Consumer Bridges Activation (Roadmap Item 8)

**Status:** DRAFT — partially active activation packet
**Authors:** Arthur Silva
**Date:** 2026-06-25
**Related:** `docs/VAULT_SEED_CONVERGENCE.md`, `docs/CONVERGENCE_ROADMAP.md` item 8,
`specs/features/2026-06-25-silo-collection-contract.md`

---

## Context & Motivation

Item 8 covers consumer bridges from `vault-seed`/`dgk` into Refarm packages. These should not be
promoted merely because code exists downstream. They activate when a second consumer or an existing
Refarm control surface proves the primitive is consumer-neutral.

The Telegram work in `vault-seed` is now enough to plan bridge 8b because Refarm already has a
generic channel-control surface (`dispatch-surface`/Farmhand `/channels/:channel/efforts`). The
adapter for Telegram remains downstream; Refarm should absorb only the channel-neutral policy and
evidence shapes.

## Bridge Split

| Bridge | Trigger | First spec must prove |
|---|---|---|
| 8a `vault-seed` `silo.js` -> `@refarm.dev/silo` | `silo` collect exists and another consumer needs scoped secret storage | model/runtime/channel/publishing namespaces remain separate |
| 8b `dgk-channels` -> channel policy blocks | **Candidate active**: `vault-seed` Telegram outbox/inbox + Refarm channel-control surfaces both need destination, rate-limit, delivery state, receipt, dry-run, and review semantics | contacts/rate limits/receipts are not Telegram- or DGK-specific |
| 8c `dgk-runner` -> `@refarm.dev/process-handoff` | another CLI needs the same process handoff lifecycle | helper is independent of DGK command names and vault paths |

## Bridge 8b Scope

Refarm candidates:

- `@refarm.dev/channel-policy-v1` or equivalent existing package surface for:
  - channel id and provider id;
  - destination/contact reference;
  - rate-limit policy and persisted limiter state shape;
  - delivery item id/hash and idempotency key;
  - delivery receipt and retry-after evidence;
  - dry-run/review gate result.
- Optional later split into `@refarm.dev/contacts` and `@refarm.dev/rate-limiter` only if package
  boundaries prove useful.

Downstream stays in `vault-seed`/DGK:

- Telegram Bot API calls and MarkdownV2 formatting;
- inbox note filenames, frontmatter, PARA routing, and Lab notebooks;
- `dgk outbox telegram`, `dgk inbox telegram`, and human-facing publication UX;
- local fallback through `@aretw0/dgk-channels` until Refarm packages are consumable.

## Rules

- One bridge per branch.
- One feature spec and plan per bridge.
- The downstream consumer remains canonical for product UX.
- Refarm owns only the neutral primitive.
- Provider adapters remain downstream until at least two providers share the same adapter surface.

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
- Moving Telegram-specific API behavior or note-writing rules into Refarm.
