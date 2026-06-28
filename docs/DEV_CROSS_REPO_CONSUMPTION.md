# Dev-time Cross-Repo Consumption (vault-seed ↔ Refarm)

> Status: decision (2026-06-25). How `vault-seed` consumes **unpublished** `@refarm.dev/*` packages
> for the item-4 "consumer proof" gates, before the first `@refarm.dev` publish (ADR-069). Closes
> convergence loose end #1 (the consumer-proof steps had no consumption path).

## Problem

`vault-seed` is a **separate repo** — `grep refarm` in its `package.json` / `pnpm-workspace.yaml`
is empty; there is no workspace link to Refarm. The 4a/4b/4c "consumer proof" steps need
`@refarm.dev/ds`, `/homestead`, `/silo` **inside `vault-seed`** before those packages are on npm.
`vault-seed` and `refarm` are separate repos — not one pnpm workspace — so `vault-seed` cannot
`workspace:*`-link Refarm packages.

## Decision

**Consumer-proof uses a local tarball — faithful to the published shape.**

1. In the Refarm working tree: build and pack the package.
   ```bash
   pnpm -C packages/<name> run build
   pnpm -C packages/<name> pack   # → refarm.dev-<name>-<version>.tgz
   ```
2. Copy the `.tgz` to `vault-seed`, e.g. into the repo-root `vault-seed/vendor/`. This is a local
   proof cache, not source; the consumer repo should ignore it.
3. In `vault-seed`: add the dependency and install.
   ```jsonc
   // package.json
   "@refarm.dev/<name>": "file:./vendor/refarm.dev-<name>-<version>.tgz"
   ```
   ```bash
   pnpm install
   ```
   If the candidate depends on another unpublished `@refarm.dev/*` package, pin the direct
   dependency and the transitive dependency to the same local tarball with `pnpm.overrides` until
   the packages are published:
   ```jsonc
   {
     "dependencies": {
       "@refarm.dev/ds": "file:./vendor/refarm.dev-ds-0.1.0.tgz",
       "@refarm.dev/homestead-ssr": "file:./vendor/refarm.dev-homestead-ssr-0.1.0.tgz"
     },
     "pnpm": {
       "overrides": {
         "@refarm.dev/ds": "file:./vendor/refarm.dev-ds-0.1.0.tgz"
       }
     }
   }
   ```
4. Run the surface (`dgk build` / `dgk serve` / the site test roteiro) — that is the proof.

Before committing the consumer proof, confirm the packed artifact stayed out of source control:

```bash
git status --short -- vendor
```

Expected: no tracked `.tgz` additions. The proof branch may keep `package.json` / lockfile changes
while it is active; the packed artifact itself stays local.

If the consumer checkout is not available from the current working environment, stop after packing
and hand off:

- package name and version;
- tarball path or checksum;
- build/pack commands used;
- expected consumer proof command.

For the current UI packet, the Refarm-side fallback proof is:

```bash
pnpm install --offline --store-dir /tmp/<proof>/.pnpm-store
node --input-type=module -e "import { shellHtml, cardHtml, buttonHtml } from '@refarm.dev/homestead-ssr'; const bodyHtml = cardHtml({ title: 'Card', rows: ['<p>Ready</p>'], actionsHtml: buttonHtml({ label: 'Open' }) }); const html = shellHtml({ title: 'Proof', bodyHtml, theme: 'verde-jardim' }); if (!html.includes('data-ds-theme=\"verde-jardim\"') || !html.includes('ds-card') || !html.includes('ds-btn') || !html.includes('/_ds/themes/verde-jardim.css')) throw new Error('consumer proof failed');"
pnpm list --depth 1
test ! -e node_modules/@refarm.dev/homestead
```

Do not replace the tarball gate with an unverified assertion.

**Quick-iteration alternative:** a `file:` dep pointing at the built package directory
(`"@refarm.dev/<name>": "file:../../refarm/packages/<name>"`). Faster, but more environment-sensitive.
The **tarball is the gate** because it ships exactly the `files` /
`exports` whitelist npm would publish — catching packaging bugs the proof must catch.

**Real consumption:** once `@refarm.dev` packages publish (ADR-069 scope settled + first release),
`vault-seed` swaps the `file:` dependency for a normal semver range. The tarball / `file:` link is
**dev-only scaffolding, removed at adoption.**

## Why tarball over `pnpm link --global`

Global link carries hidden state and diverges from the published shape; the tarball tests exactly
what npm would ship. The consumer proof exists to catch packaging and boundary bugs — the tarball
is the only option that exercises them.

## Boundary

This is **dev-time consumer-proof, not the production dependency.** `vault-seed` stays sovereign
(works with no Refarm installed); the Refarm dependency is additive when present (per
`VAULT_SEED_CONVERGENCE.md`). The consumer-proof step proves the block is consumable; it does not
make Refarm a required dependency of generated vaults.
