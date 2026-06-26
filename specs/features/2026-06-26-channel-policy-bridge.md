# Spec: Channel Policy Bridge (Roadmap Item 8b)

**Status:** ACTIVE - first Refarm-side package slice
**Date:** 2026-06-26
**Related:** `docs/VAULT_SEED_CONVERGENCE.md`,
`specs/features/2026-06-25-consumer-bridges-activation.md`

## Context

`vault-seed` Telegram outbox/inbox and Refarm channel-control surfaces both need
the same neutral evidence: destination references, idempotency, rate-limit
policy references, dry-run results, review gates, and delivery receipts.

Telegram is the first fixture, not the upstream product. Refarm should not own
Telegram Bot API calls, Markdown formatting, inbox note filenames, frontmatter,
Lab notebooks, or `dgk` command UX.

## Decision

Add `@refarm.dev/channel-policy-v1` as a structural contract package.

The first package slice owns:

- `channel-policy:v1` capability marker;
- delivery envelope schema `refarm.channel-delivery-envelope.v1`;
- destination/contact reference shape;
- rate-limit policy and evidence shapes;
- review gate states;
- dry-run and receipt shapes;
- deterministic idempotency-key helper;
- validation for the envelope.

The package deliberately does not own:

- provider network clients;
- message rendering or escaping;
- persistent rate limiter state;
- inbox/outbox note UX;
- provider credential storage;
- command vocabulary.

## Consumers

1. Refarm channel-control surfaces (`dispatch-surface`/Farmhand channels) can
   emit or validate the same delivery envelope for channel efforts.
2. `vault-seed` can keep Telegram behavior downstream while emitting dry-run,
   review, rate-limit, and receipt evidence with this neutral shape.

## Package Boundary

Start as one package. Do not split `contacts` or `rate-limiter` until a second
provider or conformance suite proves independent versioning pressure.

`@refarm.dev/silo` remains the credential boundary. Channel policy references
provider and destination identities but never stores tokens.

## Verification

- package unit tests cover the Refarm channel-control fixture;
- package unit tests cover the `vault-seed` Telegram fixture;
- invalid/dangling receipts are rejected;
- `validate-packages` sees the package as a normal public buildable package;
- release policy can select it as a `vault-seed-ready` candidate while actual
  publication still waits on the first downstream proof.

## Rollback

Consumers can keep their existing downstream-local channel state. This package
is additive until a consumer chooses to emit the envelope.
