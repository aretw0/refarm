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
2. Copy the `.tgz` to `vault-seed` (shared host filesystem), e.g. into `vault-seed/vendor/`.
3. In `vault-seed`: add the dependency and install.
   ```jsonc
   // package.json
   "@refarm.dev/<name>": "file:./vendor/refarm.dev-<name>-<version>.tgz"
   ```
   ```bash
   pnpm install
   ```
4. Run the surface (`dgk build` / `dgk serve` / the site test roteiro) — that is the proof.

**Quick-iteration alternative:** a `file:` dep pointing at the built package directory
(`"@refarm.dev/<name>": "file:../../refarm/packages/<name>"`). Faster, but requires path alignment
across the container boundary. The **tarball is the gate** because it ships exactly the `files` /
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
