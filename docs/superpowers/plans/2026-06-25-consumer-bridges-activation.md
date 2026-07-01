# Plan: Consumer Bridges Activation (Roadmap Item 8)

> Spec: `specs/features/2026-06-25-consumer-bridges-activation.md`.
> Goal: avoid re-deciding bridge boundaries when a second consumer appears.

## Task 1 - Identify Bridge and Second Consumer

- Choose exactly one bridge: 8a, 8b, or 8c.
- Name the second consumer and the repeated primitive.
- Gate: no second consumer or Refarm control surface, no bridge.

Current activation notes:

- 8a activates after `silo` collect exists.
- 8b is candidate-active because `vault-seed` Telegram outbox/inbox and Refarm channel-control
  surfaces both need channel policy/evidence primitives.
- 8c is candidate-active through `dgk-runner` and Refarm process handoff.

## Task 2 - Write Focused Bridge Spec

- Define the neutral Refarm package/API.
- Define the downstream adapter shape.
- Define what stays in `vault-seed`/`dgk`.
- Gate: product UX remains downstream-owned.

For 8b, the focused spec must use the Telegram implementation only as a fixture. The neutral API
should cover destination/contact references, rate-limit policy, delivery item id/hash, receipt,
retry-after evidence, dry-run result, and review gate status. Telegram Bot API calls, MarkdownV2
formatting, inbox filenames, frontmatter, and Lab notebooks stay downstream.

## Task 3 - Package and Acceptance Plan

- Decide whether this is a new package or an existing package surface.
- Wire `test-capabilities`, `gate-smoke-contracts`, build order, and changeset.

For 8b, start as one `channel-policy-v1` style surface unless tests prove that `contacts` and
`rate-limiter` need separate package boundaries immediately.

## Task 4 - Consumer Proof

- Prove both consumers can use the neutral primitive.
- Keep fallback to downstream-local behavior until published package consumption is stable.

For 8b:

- Refarm proof: `dispatch-surface`/Farmhand channel-control fixture can emit or validate the same
  channel policy/evidence envelope.
- `vault-seed` proof: Telegram outbox/inbox can keep using its adapter while producing the neutral
  dry-run/receipt/rate-limit evidence.

## Non-Goal

Do not use item 8 as a general cleanup bucket. It is only for repeated, consumer-neutral
primitives.
