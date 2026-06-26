# Channel Policy Bridge (Item 8b) Implementation Plan

> Spec: `specs/features/2026-06-26-channel-policy-bridge.md`.
> Goal: make the channel-neutral delivery evidence shape consumable without
> moving Telegram or DGK product behavior upstream.

## Task 1 - Package Contract

- Add `packages/channel-policy-v1`.
- Export `channel-policy:v1`, envelope schema, destination, rate-limit,
  review, dry-run, receipt, and idempotency-key types/helpers.
- Keep dependencies empty; provider adapters stay downstream.

## Task 2 - Consumer Fixtures

- Add a Refarm channel-control fixture.
- Add a `vault-seed` Telegram fixture that stores provider ids and receipts but
  no Telegram API behavior or Markdown formatting.
- Add invalid receipt/dangling evidence tests.

## Task 3 - Gates and Release Policy

- Add the package to `test:capabilities` and `gate:smoke:contracts`.
- Add a `vault-seed-ready` candidate release-policy entry after the package has
  Refarm fixtures and a downstream handoff path.
- Add a changeset.

## Task 4 - Handoff

- Record the new 8b packet in readiness/release docs.
- Downstream proof remains pending until the official `vault-seed` checkout
  emits this envelope from its Telegram adapter.
