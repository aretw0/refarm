# Channel Policy Bridge (Item 8b) Implementation Plan

> Spec: `specs/features/2026-06-26-channel-policy-bridge.md`.
> Goal: make the channel-neutral delivery evidence shape consumable without
> moving Telegram or DGK product behavior upstream.

## Task 1 - Package Contract

- [x] Add `packages/channel-policy-v1`.
- [x] Export `channel-policy:v1`, envelope schema, destination, rate-limit,
  review, dry-run, receipt, and idempotency-key types/helpers.
- [x] Keep dependencies empty; provider adapters stay downstream.

## Task 2 - Consumer Fixtures

- [x] Add a Refarm channel-control fixture.
- [x] Add a `vault-seed` Telegram fixture that stores provider ids and receipts but
  no Telegram API behavior or Markdown formatting.
- [x] Add invalid receipt/dangling evidence tests.

## Task 3 - Gates and Release Policy

- [x] Add the package to `test:capabilities` and `gate:smoke:contracts`.
- [x] Add a `vault-seed-ready` candidate release-policy entry after the package has
  Refarm fixtures and a downstream handoff path.
- [x] Add a changeset.

## Task 4 - Handoff

- [x] Record the new 8b packet in readiness/release docs.
- [x] Downstream proof remains pending until the official `vault-seed` checkout
  emits this envelope from its Telegram adapter.

2026-06-26 packet:
- Candidate tarball:
  `.refarm/handoff/vault-seed/2026-06-26/refarm.dev-channel-policy-v1-0.1.0.tgz`
  (`sha256 9daaa089560b558a145b0af78dc09a8b66cfd13decce362d205f7362d97f4ddf`).
- Tarball contents are limited to `dist/`, `package.json`, `README.md`, and
  `LICENSE`.
- Local validation: `pnpm --filter @refarm.dev/channel-policy-v1 run build` and
  `pnpm --filter @refarm.dev/channel-policy-v1 run test`.
