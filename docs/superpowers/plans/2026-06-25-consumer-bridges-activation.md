# Plan: Consumer Bridges Activation (Roadmap Item 8)

> Spec: `specs/features/2026-06-25-consumer-bridges-activation.md`.
> Goal: avoid re-deciding bridge boundaries when a second consumer appears.

## Task 1 - Identify Bridge and Second Consumer

- Choose exactly one bridge: 8a, 8b, or 8c.
- Name the second consumer and the repeated primitive.
- Gate: no second consumer, no bridge.

## Task 2 - Write Focused Bridge Spec

- Define the neutral Refarm package/API.
- Define the downstream adapter shape.
- Define what stays in `vault-seed`/`dgk`.
- Gate: product UX remains downstream-owned.

## Task 3 - Package and Acceptance Plan

- Decide whether this is a new package or an existing package surface.
- Wire `test-capabilities`, `gate-smoke-contracts`, build order, and changeset.

## Task 4 - Consumer Proof

- Prove both consumers can use the neutral primitive.
- Keep fallback to downstream-local behavior until published package consumption is stable.

## Non-Goal

Do not use item 8 as a general cleanup bucket. It is only for repeated, consumer-neutral
primitives.
