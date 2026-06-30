# Vault-Seed Silo Bridge (Item 8a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make `vault-seed/packages/cli/src/silo.js` delegate publishing-channel credential storage
to `@refarm.dev/silo` while preserving `vault-seed`'s `dgk sow` UX and keeping model/runtime/channel
secret classes separate.

**Architecture:** 8a uses the existing `@refarm.dev/silo` package from 4c. The first implementation
is a downstream adapter in `vault-seed`, not a new Refarm package. Refarm only grows small namespace
helpers if the consumer proof shows unavoidable repeated logic.

**Spec:** `specs/features/2026-06-26-vault-seed-silo-bridge.md`

**Reconciled 2026-06-26:** The first Refarm-side package proof stayed
adapter-only; no new `@refarm.dev/silo` helper API was needed for that handoff.
The current historical handoff tarballs are:

- `.refarm/handoff/vault-seed/2026-06-26/refarm.dev-silo-0.1.0.tgz`
  (`sha256 3335f225a6161769c1e44ff199007c3accf1f51aa69a4b5d0a1bd71be26189d5`);
- `.refarm/handoff/vault-seed/2026-06-26/refarm.dev-heartwood-0.1.0.tgz`
  (`sha256 0604de49b56d739c4aeac6a29162a6f5d3f79609b5bab1d872e8fb3d0c43daaf`).

Pre-publication storage-only consumers should install `@refarm.dev/silo` from
the local tarball without pulling the identity/Heartwood closure. Consumers that
call `bootstrapIdentity()` should also install the matching local
`@refarm.dev/heartwood` tarball as the optional identity substrate. The
temporary consumer proof saved `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and a
collected dry-run value under namespace `publishing`, verified they did not
enter the flat `tokens` map or the `model` namespace, and now treats
`@refarm.dev/silo` storage as the base package while `@refarm.dev/heartwood`
belongs to the identity path.

## Global Constraints

- One bridge only: 8a `vault-seed` `silo.js` -> `@refarm.dev/silo`.
- `publishing` is the namespace for `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and future publishing
  service credentials.
- Model/runtime credentials stay under `model`/`runtime`; channel topology and contacts stay
  downstream until item 8b.
- Do not delete `~/.dgk/silo.json` automatically.
- Do not edit the Refarm `generators/vault-seed` output to fake this proof. The proof is the real
  consumer package.

---

### Task 1: Consumer adapter contract test in `vault-seed`

**Files in `vault-seed`:**
- Modify/create focused tests around `packages/cli/src/silo.js`.

- [ ] **Step 1:** Add a test that saves Telegram tokens and verifies they are stored under Silo
  namespace `publishing`, not the flat Refarm token map.
- [ ] **Step 2:** Add a test that `loadSiloEnv()` returns the same `{ TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID }` shape expected by `publish_to_telegram` and `inbox_from_telegram`.
- [ ] **Step 3:** Add a test that missing Silo values can still fall back to legacy
  `~/.dgk/silo.json` while the bridge is rolling out.
- [ ] **Step 4:** Run the focused `vault-seed` CLI tests before implementation and confirm the new
  bridge tests fail for the expected reason.

---

### Task 2: Implement the `vault-seed` adapter

**Files in `vault-seed`:**
- Modify: `packages/cli/src/silo.js`
- Modify call sites only where async delegation requires it.
- Modify: `packages/cli/package.json`, workspace lock/template as needed to consume `@refarm.dev/silo`.

- [ ] **Step 1:** Add `@refarm.dev/silo` as a local/packed consumer dependency.
- [ ] **Step 2:** Keep `SERVICES`, service labels, prompts, masking, and contacts-location behavior
  downstream-owned.
- [ ] **Step 3:** Route `saveTokens` writes to `SiloCore.saveSecret("publishing", key, value)`.
- [ ] **Step 4:** Route `loadSiloEnv`, `siloStatus`, `removeService`, and `injectSiloEnv` through
  namespace-aware reads/writes, preserving existing return shapes.
- [ ] **Step 5:** Keep legacy `~/.dgk/silo.json` as read fallback only; do not auto-delete it.
- [ ] **Step 6:** Run focused `vault-seed` tests:

```bash
pnpm -C packages/cli test -- test/sow.test.js test/serve.test.js
node --test scripts/publish_to_telegram.test.mjs scripts/inbox_from_telegram.test.mjs
```

---

### Task 3: Refarm acceptance check

**Files in `refarm`:**
- Modify only if the consumer proof shows `@refarm.dev/silo` needs small namespace helper APIs.

- [x] **Step 1:** Determine whether helper APIs are needed; if so, add them to
  `packages/silo/src/collect.js` or `packages/silo/src/index.js` with focused tests.
- [x] **Step 2:** Run:

```bash
pnpm -C packages/silo run lint
pnpm -C packages/silo run build
pnpm -C packages/silo run test
```

- [x] **Step 3:** Add a changeset if `@refarm.dev/silo` public API or published dependency
  metadata changes.
- [x] **Step 4:** Run `refarm agent finish --lane after-edit --run --json` before committing.

2026-06-29 follow-up: the downstream proof showed repeated namespace operations
that belong in `@refarm.dev/silo` rather than every consumer. Refarm added
`listSecrets(namespace)`, `removeSecret(namespace, id)`, owner-only storage
modes, and the ADR-076 storage/identity closure split.

Earlier validation was run with direct local binaries after the lockfile changed,
to avoid `pnpm run` triggering a broad install in the restricted container:

```bash
./node_modules/.bin/eslint packages/silo/src
./node_modules/.bin/tsc --project packages/silo/tsconfig.build.json
../../node_modules/.bin/vitest run src/index.test.ts src/collect.test.ts src/secrets.test.ts
```

---

### Task 4: Consumer proof handoff

- [x] **Step 1:** Document the exact `@refarm.dev/silo` tarball/path used by `vault-seed`.
- [x] **Step 2:** Record whether the bridge stayed adapter-only or required Refarm helper APIs.
- [x] **Step 3:** Commit Refarm-side changes separately from downstream `vault-seed` changes.

Refarm-side commit: `394ee1e2 fix(silo): trim unused ed25519 dependency`.

## Non-Goal

Do not implement item 8b here. Contacts, rate limits, delivery receipts, dry-run evidence, and
Telegram adapter behavior stay out of this bridge.

## Self-Review

**Spec coverage:** one bridge only -> global constraints; two consumers -> `apps/refarm` already uses
`@refarm.dev/silo` and `vault-seed` becomes the second consumer; neutral API -> existing
`SiloCore` namespace methods plus `listSecrets`/`removeSecret`; downstream ownership -> service
catalog/admin UX stay in `vault-seed`; fallback -> legacy file read only; package acceptance ->
Task 3.

**Placeholder scan:** the implementation tasks name concrete files, namespace, keys, tests, and
fallback behavior. Conditional Refarm helper work was gated by consumer proof and then folded into
the Silo v0.1.1 storage surface.
