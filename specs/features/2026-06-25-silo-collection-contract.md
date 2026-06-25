# Spec: Silo Collection Contract (Roadmap Item 4c)

**Status:** DRAFT — ready for implementation
**Authors:** Arthur Silva
**Date:** 2026-06-25
**Related:** `docs/CONVERGENCE_ROADMAP.md` (item 4), `docs/APPS_REFARM_PROMOTION_LEDGER.md`, `docs/VAULT_SEED_CONVERGENCE.md` ("don't merge all secrets")

---

## Context & Motivation

The audit framed `credentials/` ↔ `silo` as a conflict. The cola (cross-repo read) showed they are
**different layers**, not duplicates:

- `@refarm.dev/silo` — "Context and Secret **Provisioner**" — stores/provisions secrets
  (`key-manager`, isomorphic `index.browser`). The **storage/provision** layer.
- `apps/refarm/src/credentials/` — `CredentialProvider { id, label, collect(ctx) }` — the **UX of
  collecting** a secret from the operator (open an OAuth URL, prompt). The **collection** layer.
- `vault-seed/packages/cli/src/silo.js` — a parallel local store for publishing-channel creds.

So there is nothing to extract between `credentials/` and `silo` — one collects, the other stores.
But the **collection abstraction is good for everyone**: `vault-seed`'s `serve.js` config panel
already collects channel tokens — the same shape. Decision (owner, 2026-06-25): promote the
collection contract into `silo`'s provisioning surface (`silo` is literally the Provisioner).
`refarm`'s `credentials/` providers and `vault-seed`'s channel collection both become `silo`
collectors. Storage and collection unify under `silo`, with **secret namespaces kept separate**
(model/runtime vs publishing-channel — per the convergence doc's "don't merge all secrets").

(The actual adoption of `@refarm.dev/silo` storage by `vault-seed`'s `silo.js` is roadmap **item 8**,
deferred. This spec only adds the collection contract and re-homes `refarm`'s providers onto it.)

## Decisions

1. **`silo` exposes a collection contract** beside its storage API: `CredentialProvider` +
   `CollectContext`, lifted from `apps/refarm/src/credentials/types.ts` and generalized.
2. **Namespaced collection.** `CredentialProvider` gains a `namespace` so collected secrets route to
   the right secret class (`model`, `runtime`, `channel`, `publishing`) — collection never merges
   classes.
3. **`refarm credentials/` re-homes onto the contract.** The github/cloudflare/model providers
   implement `silo`'s `CredentialProvider` and import the interface from `@refarm.dev/silo` instead
   of the local `types.ts`. Their concrete operator flows (OAuth URLs, prompts) stay in the app.
4. **`vault-seed` channel collection** becomes a `CredentialProvider` (namespace `channel`) — wired
   when `vault-seed` adopts `@refarm.dev/silo` (item 8).

## 1. Contract (`packages/silo/src/collect.ts`)

```ts
import type { OperatorChannel } from "@refarm.dev/prompt-contract-v1";

export interface CollectContext {
  tryOpenUrl: (url: string) => void;
  operator?: OperatorChannel;
}

export interface CredentialProvider {
  readonly id: string;
  readonly label: string;
  /** Silo secret namespace the collected value belongs to (keeps secret classes separate). */
  readonly namespace: string;
  collect(ctx: CollectContext): Promise<string>;
}

export interface SiloCollectResult {
  id: string;
  namespace: string;
  stored: boolean;
}

/**
 * Collect a secret via the provider and persist it into silo under provider.namespace.
 * Uses silo's existing storage/key-manager; does not merge namespaces.
 */
export function collectAndStore(
  provider: CredentialProvider,
  ctx: CollectContext,
): Promise<SiloCollectResult>;
```

`collect.ts` wires `collectAndStore` to `silo`'s existing storage (`key-manager`). Exported from
`packages/silo/src/index.ts`.

## 2. Package wiring

**refarm `silo`:**
- Add `src/collect.ts` + `src/collect.test.ts`; export from `index.ts`.
- Add dep `@refarm.dev/prompt-contract-v1` (for `OperatorChannel`); verify the dependency graph
  stays acyclic.

**refarm `apps/refarm/src/credentials/`:**
- `types.ts` re-exports the contract from `@refarm.dev/silo` (single source of truth) — keep the
  local file as a thin re-export to avoid touching every importer at once.
- `github.ts`, `cloudflare.ts`, `model.ts` add `namespace` (`runtime` for github/cloudflare infra
  creds, `model` for model keys) and call `collectAndStore` where they previously persisted.

**vault-seed (item 8, noted not built here):**
- `serve.js` channel config implements a `CredentialProvider` with `namespace: "channel"`.

## 3. Verification plan

1. **Collect unit test:** a fake `CredentialProvider` collects → `collectAndStore` persists under its
   `namespace`; two providers with different namespaces do not collide in storage.
2. **App conformance:** `apps/refarm` credential providers satisfy the `silo` `CredentialProvider`
   interface; existing credential flow tests (`credentials/model.test.ts`,
   `token-auth-error.test.ts`) still pass.
3. **Acyclic check:** `silo` → `prompt-contract-v1` introduces no dependency cycle.
4. **Final gate:** `pnpm -C packages/silo run lint && type-check && test`.

## 4. Out of scope

- `vault-seed` `silo.js` adopting `@refarm.dev/silo` storage — **item 8** (consumer bridge).
- OAuth/token flow internals (github URL dance, prompts) — stay app-local UX.
- Storage/`key-manager` changes — unchanged; this spec adds a collection front door only.

## 5. Decisions (resolved 2026-06-25 — no mid-build pauses)

- **Only the contract moves into `silo` now**; the concrete providers stay in `apps/refarm`.
  Migrate a provider into `silo` only when a second consumer needs that same provider.
- **`silo` documents a reserved namespace set** — `model`, `runtime`, `channel`, `publishing` —
  and consumers may extend it.

## 6. Integration

- **Package acceptance:** `silo` already exists — apply `docs/PACKAGE_ACCEPTANCE_CHECKLIST.md`
  #2/#3 (register the `collect` test) and #6 (changeset) when implementing; verify the new
  `silo → prompt-contract-v1` dep keeps `task:build-order:check` green.
- **Consumer adoption** of `silo` storage by `vault-seed`'s `silo.js` is **item 8** (deferred), via
  the consumption path in `docs/DEV_CROSS_REPO_CONSUMPTION.md` when it lands.
