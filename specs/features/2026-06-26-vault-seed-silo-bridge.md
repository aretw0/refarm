# Spec: Vault-Seed Silo Bridge (Roadmap Item 8a)

**Status:** DRAFT - Refarm-side package proof complete; `vault-seed` adapter implementation pending
**Authors:** Arthur Silva
**Date:** 2026-06-26
**Related:** `specs/features/2026-06-25-silo-collection-contract.md`,
`specs/features/2026-06-25-consumer-bridges-activation.md`,
`docs/VAULT_SEED_CONVERGENCE.md`

---

## Context

`@refarm.dev/silo` now exposes the shared namespaced collection/storage contract:
`SiloCore.saveSecret(namespace, id, value)`, `loadSecret(namespace, id)`,
`CredentialProvider`, and `collectAndStore`.

`vault-seed/packages/cli/src/silo.js` still stores publishing-channel credentials in a local
`~/.dgk/silo.json` shape:

```json
{
  "tokens": {
    "TELEGRAM_BOT_TOKEN": "...",
    "TELEGRAM_CHAT_ID": "..."
  },
  "updatedAt": "..."
}
```

That file explicitly scopes itself to publishing-channel credentials and says model/AI credentials
come from Refarm. The bridge is therefore not a general secret migration. It is a scoped adapter:
`vault-seed` keeps its product UX and service catalog, while credential persistence delegates to
`@refarm.dev/silo` under the `publishing` namespace.

## Decisions

1. **Use the existing `@refarm.dev/silo` package.** No new bridge package is needed for 8a.
2. **Keep downstream UX downstream.** `dgk sow telegram`, admin-server endpoints, Telegram chat
   discovery, masking, and service labels stay in `vault-seed`.
3. **Store publishing credentials under namespace `publishing`.** Model/runtime credentials remain
   in their existing `model` and `runtime` namespaces; channel topology remains outside Silo.
4. **Preserve the `vault-seed` local API first.** `loadSiloEnv`, `saveTokens`, `removeService`,
   `siloStatus`, `injectSiloEnv`, `getContactsLocation`, and `setContactsLocation` keep their
   external behavior while their persistence backend changes.
5. **No one-shot destructive migration.** Existing `~/.dgk/silo.json` may be read as a legacy
   fallback/import source, but the bridge must not delete it automatically.

## Neutral Surface

Refarm-owned surface:

- `SiloCore.saveSecret("publishing", id, value)`
- `SiloCore.loadSecret("publishing", id)`
- optional small helpers in `@refarm.dev/silo` only if the consumer proof shows repeated bulk
  namespace operations that would otherwise be duplicated.

Downstream adapter shape in `vault-seed`:

```js
const PUBLISHING_NAMESPACE = "publishing";

export async function saveTokens(tokens, core = new SiloCore()) {
  for (const [key, value] of Object.entries(tokens)) {
    await core.saveSecret(PUBLISHING_NAMESPACE, key, value);
  }
}

export async function loadSiloEnv(core = new SiloCore()) {
  return Object.fromEntries(
    await Promise.all(SERVICES.telegram.keys.map(async (key) => [key, await core.loadSecret(PUBLISHING_NAMESPACE, key)])),
  );
}
```

The exact implementation can stay synchronous only if it remains on the legacy local file. Once it
delegates to `SiloCore`, the affected call sites should become async intentionally and be covered by
the existing `vault-seed` CLI/admin tests.

## Consumer Proof

The first proof is in `vault-seed`, not a generated fixture:

1. add `@refarm.dev/silo` as a local/packed dependency for the consumer proof;
2. adapt `packages/cli/src/silo.js` behind the existing exported functions;
3. update affected call sites/tests for async if needed;
4. run focused tests:
   - `pnpm -C packages/cli test -- test/sow.test.js test/serve.test.js`;
   - `node --test scripts/publish_to_telegram.test.mjs scripts/inbox_from_telegram.test.mjs`.

The Refarm-side acceptance signal is that the same `@refarm.dev/silo` namespace contract remains
green:

```bash
pnpm -C packages/silo run lint
pnpm -C packages/silo run build
pnpm -C packages/silo run test
```

2026-06-26 Refarm-side handoff: `.refarm/handoff/vault-seed/2026-06-26/refarm.dev-silo-0.1.0.tgz`
(`sha256 3335f225a6161769c1e44ff199007c3accf1f51aa69a4b5d0a1bd71be26189d5`) plus
`.refarm/handoff/vault-seed/2026-06-26/refarm.dev-heartwood-0.1.0.tgz`
(`sha256 0604de49b56d739c4aeac6a29162a6f5d3f79609b5bab1d872e8fb3d0c43daaf`) for the unpublished
transitive dependency. The temporary consumer proof installed both from local tarballs, wrote
Telegram credentials under namespace `publishing`, confirmed they did not enter the flat `tokens`
map or `model` namespace, and kept the bridge adapter-only.

## Migration And Fallback

- On read, the adapter may prefer Silo and fall back to legacy `~/.dgk/silo.json` when a key is
  missing.
- On write, new values go to Silo `publishing`.
- Legacy file deletion is out of scope. A later cleanup command can compact/remove it after the
  consumer proof has shipped.
- `contacts.location` remains in `vault-seed` local state until item 8b decides the channel-policy
  contract.

## Out Of Scope

- Moving Telegram API calls, Markdown formatting, note-writing, or admin UX into Refarm.
- Merging model/runtime secrets with publishing-channel credentials.
- Migrating contacts/rate-limit/receipt state. That is item 8b.
- Publishing a generated vault.

---

## Consumer Findings (2026-06-29, vault-seed proof)

This section supplies the consumer evidence this spec invited ("optional small helpers in
`@refarm.dev/silo` only if the consumer proof shows repeated bulk namespace operations"). Findings
were verified against `packages/silo/dist` and `vault-seed/packages/cli/src/silo.js`.

### Bulk namespace operations are real → `listSecrets` / `removeSecret`

The bridge cannot preserve the existing `vault-seed` API on `loadSecret(ns, id)` alone:

- `siloStatus()` enumerates **every configured key across a namespace** to render the admin/check
  status (per-service `configured` + masked `preview`). There is no single-key form.
- `removeService(serviceId)` deletes a service's **whole key set** from the namespace.

Both are repeated bulk-per-namespace operations with no single-id equivalent. This is the proof the
spec asked for: promote two helpers into `silo` so consumers do not each re-walk the store —
`listSecrets(namespace): Promise<Record<id, value>>` (or id list) and `removeSecret(namespace, id)`.

### `CredentialProvider.collect` is single-value; real services are multi-field

`collect(ctx): Promise<string>` returns one secret. The telegram channel is a **two-field set**:
`TELEGRAM_BOT_TOKEN` (secret) + `TELEGRAM_CHAT_ID` (non-secret, auto-discovered). Either model the
service as **one provider per key** (namespace `channel`, `id` = the env key) — which composes
cleanly once `listSecrets` exists — or extend the contract to a credential-set collect. The
per-field `secret` flag (masking) and the discovery flow stay product-side UX.

### Install-closure separation → ADR-076

Verified: the `heartwood` WASM is loaded lazily at runtime (never for a storage-only consumer), but
`heartwood` is a hard `dependency` and `index.js` statically imports `key-manager.js`, so a
`channel`-only consumer still pulls the identity closure into its install. Tracked as **ADR-076**
(storage surface free of the identity closure). Prerequisite for a clean "light by default" adoption.

### Storage permission hardening (security now, before OPAQUE)

Verified: `silo` storage performs no `chmod`/`mode` hardening (`writeFileSync` without `mode`;
`_ensureStorage` is a bare recursive `mkdir`). The `vault-seed` code it replaces writes `0600`/`0700`
with a Windows no-op guard. Storage should match this **now**, independent of the v0.2.0 OPAQUE
at-rest encryption (ADR-076 decision 3).

### Env hydration helper (candidate, may stay downstream)

`injectSiloEnv()` (non-overriding hydrate of a namespace's secrets into `process.env`) is the
consumer hot path (`etl`/`inbox`/`lab`/`outbox`). `resolve()→Map` covers provider tokens, not a
namespace hydrate. A namespace-scoped hydrate helper would avoid each consumer re-implementing it —
flagged as a candidate, not a blocker; it can stay in `vault-seed` if `silo` prefers a thin storage
surface.

### Storage location pin (resolved)

`config.storagePath` lets the bridge pin `~/.dgk/silo.json` (the default is
`resolveSiloHome()/identity.json`). No new API needed; document the legacy-file import + `storagePath`
override in the adapter.

### Security roadmap — consumer demand affirmed

vault-seed affirms real consumer demand for **v0.2.0 OPAQUE Protection** (at-rest encryption) and
**v0.3.0 Sentinel Isolation** (isolated WASM + TPM/HSM). The near-term value of adoption is namespace
convergence + unified storage; the encryption our users deserve is what the roadmap already plans.
This is a prioritization signal, not new scope. The consumer-surface items above are folded into the
revised `packages/silo/ROADMAP.md` v0.1.1 so the package ships consumer-complete in one push.
