# Spec: Vault-Seed Silo Bridge (Roadmap Item 8a)

**Status:** DRAFT - ready for implementation
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
