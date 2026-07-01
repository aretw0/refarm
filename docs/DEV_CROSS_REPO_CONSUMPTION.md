# Dev-time Cross-Repo Consumption (vault-seed ↔ Refarm)

> Status: decision (2026-06-25). How `vault-seed` consumes **unpublished** `@refarm.dev/*` packages
> for the item-4 "consumer proof" gates, before the first `@refarm.dev` publish (ADR-069). Closes
> convergence loose end #1 (the consumer-proof steps had no consumption path).

## Problem

`vault-seed` is a **separate repo** — `grep refarm` in its `package.json` / `pnpm-workspace.yaml`
is empty; there is no workspace link to Refarm. The item-4 and item-9 consumer proof steps need
selected `@refarm.dev/*` packages inside `vault-seed` before those packages are on npm.
`vault-seed` and `refarm` are separate repos — not one pnpm workspace — so `vault-seed` cannot
`workspace:*`-link Refarm packages.

## Decision

**Consumer-proof uses a local tarball — faithful to the published shape.**

1. In the Refarm working tree, materialize the current `vault-seed-ready`
   packet:
   ```bash
   pnpm --silent run release:vault-seed:check -- --plan --json
   pnpm --silent run release:vault-seed:handoff -- --pack --prune-extra --json --out .refarm/handoff/vault-seed/<YYYY-MM-DD>/manifest.json
   pnpm --silent run release:vault-seed:handoff -- --out .refarm/handoff/vault-seed/<YYYY-MM-DD>/manifest.md
   ```
   The packet directory contains `manifest.json`, `manifest.md`, and the
   `.tgz` files named by `manifest.json` `packages[].tarball`.
2. Copy the needed `.tgz` files to `vault-seed`, e.g. into the repo-root
   `vault-seed/vendor/`. This is a local proof cache, not source; the consumer
   repo should ignore it. Keep `manifest.json` beside the copied tarballs or in
   the proof notes so the official checkout can verify `packages[].sha256` and
   follow `consumerProofs`. Also record `distributionEvidence.currentRef` and
   `distributionEvidence.rollback.targetRef` in the proof notes; this captures
   which local handoff was copied and how to roll back before public packages
   exist.
3. In `vault-seed`: add the dependency and install.
   ```jsonc
   // package.json
   "@refarm.dev/<name>": "<manifest consumerInstall.fileSpecs entry>"
   ```
   ```bash
   pnpm install
   ```
   If the candidate depends on another unpublished `@refarm.dev/*` package, pin
   the direct dependency and the transitive dependency to the same local packet
   with `consumerInstall.pnpmOverrides` until the packages are published:
   ```jsonc
   {
     "dependencies": {
       "@refarm.dev/ds": "file:./vendor/refarm.dev-ds-0.1.0.tgz" // from consumerInstall.fileSpecs
     },
     "pnpm": {
       "overrides": {
         "@refarm.dev/heartwood": "file:./vendor/refarm.dev-heartwood-0.1.0.tgz" // from consumerInstall.pnpmOverrides
       }
     }
   }
   ```
4. Run the surface (`dgk build` / `dgk serve` / the site test roteiro) — that is the proof.

Manual single-package pack remains an escape hatch for a package that is not in
`vault-seed-ready` yet, but it is not the official handoff path:

   ```bash
   pnpm -C packages/<name> run build
   pnpm -C packages/<name> pack   # → refarm.dev-<name>-<version>.tgz
   ```

Before committing the consumer proof, confirm the packed artifact stayed out of source control:

```bash
git status --short -- vendor
```

Expected: no tracked `.tgz` additions. The proof branch may keep `package.json` / lockfile changes
while it is active; the packed artifact itself stays local.

If the consumer checkout is not available from the current working environment, stop after packing
and hand off:

- manifest path and date;
- selected package names and versions;
- tarball paths and SHA-256 values from `manifest.json`;
- `consumerInstall.fileSpecs` and `consumerInstall.pnpmOverrides`;
- `distributionEvidence.state`, `distributionEvidence.currentRef`, and rollback target;
- handoff commands used;
- expected consumer proof commands from `consumerProofs`.

For the current UI packet, the Refarm-side fallback proof is:

```bash
pnpm install --offline --store-dir /tmp/<proof>/.pnpm-store
node --input-type=module -e "import { documentHtml, cardHtml, buttonHtml } from '@refarm.dev/ds/html'; const bodyHtml = cardHtml({ title: 'Card', rows: ['<p>Ready</p>'], actionsHtml: buttonHtml({ label: 'Open' }) }); const html = documentHtml({ title: 'Proof', bodyHtml, theme: 'verde-jardim' }); if (!html.includes('data-ds-theme=\"verde-jardim\"') || !html.includes('ds-card') || !html.includes('ds-btn') || !html.includes('/_ds/themes/verde-jardim.css')) throw new Error('consumer proof failed');"
pnpm list --depth 1
test ! -e node_modules/@refarm.dev/homestead
```

Do not replace the tarball gate with an unverified assertion.

**Quick-iteration alternative:** a `file:` dep pointing at the built package directory
(`"@refarm.dev/<name>": "file:../../refarm/packages/<name>"`). Faster, but more environment-sensitive.
The **tarball is the gate** because it ships exactly the `files` /
`exports` whitelist npm would publish — catching packaging bugs the proof must catch.

When iterating on a pre-publication `file:` tarball, do not trust package
name/version alone. If `manifest.json` reports a changed `packages[].sha256` for
the same tarball name, replace the consumer's `vendor/*.tgz`, refresh the
package-manager lockfile integrity entry or reinstall from clean `node_modules`,
and rerun the consumer proof. The generated handoff exposes this as
`consumerInstall.revendorPolicy`.

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
