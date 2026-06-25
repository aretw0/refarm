# Spec: Generator-First Vault-Seed Distribution (Roadmap Item 9a)

**Status:** DRAFT — ready for planning/prototype
**Authors:** Arthur Silva
**Date:** 2026-06-25
**Related:** `docs/CONVERGENCE_ROADMAP.md` item 9, `docs/CONVERGENCE_FACTORY_READINESS.md`,
`vault-seed .github/workflows/initialize.yml`, `vault-seed scripts/smoke_user_e2e.mjs`

---

## Context & Motivation

`vault-seed` is currently a full template repository. That is useful for dogfood, but expensive to
keep aligned when Refarm becomes the factory. The desired direction is not "copy files by hand"; it
is a generator/codemod-style path where Refarm can materialize a generated vault, then run the
same generated-vault smoke gates that `vault-seed` already trusts.

The generator must respect the template boundary: files that exist only for template development
must remain behind `initialize.yml` or the generator manifest.

## Decisions

1. **Manifest first.** Before generating files, define a manifest that classifies source paths:
   template payload, template-dev-only, generated-user files, derived artifacts, and ignored local
   state.
2. **No bespoke fork of `vault-seed`.** The generator consumes `vault-seed` as source material via
   the librarian/source contract or a pinned local checkout. It does not manually re-author the
   template in Refarm.
3. **Generated vault must pass existing smoke.** The first proof is not feature parity by inspection;
   it is running `vault-seed`'s generated-vault smoke suite against the generated output.
4. **Codemods only for repeatable transforms.** Use codemods for package names, repository identity,
   feature flags, and template-dev file removal. Do not encode one-off editorial decisions as
   transforms.
5. **Round-trip inventory is the contract.** Refarm must be able to explain which source file
   produced each generated file, which transform touched it, and which validation covers it.

## Manifest Shape

Initial file: `generators/vault-seed/manifest.json` or equivalent.

Required fields per entry:

- `source`: path in `vault-seed`;
- `target`: generated-vault path or `null` for template-dev-only;
- `class`: `payload`, `dev-only`, `derived`, `local-state`, or `transform`;
- `transforms`: ordered transform IDs;
- `validation`: smoke/test/docs path that covers the generated result.

## Prototype Scope

The first prototype generates a minimal but valid vault:

- PARA folders and onboarding notes;
- package/workflow files needed to run local validation;
- site/Lab config sufficient for smoke;
- no user secrets, no local caches, no generated dist artifacts.

## Verification

1. `refarm gen vault-seed --source <path> --out <tmp>` materializes a vault.
2. Generated output has no template-dev-only files.
3. Generated output passes the selected `vault-seed` smoke gate.
4. Inventory report maps every generated file back to source + transforms.

## Out of Scope

- Replacing `vault-seed` as the canonical dogfood repository.
- Publishing a generated vault release.
- Migrating real user vaults. This spec is for initial generation, not migration.
