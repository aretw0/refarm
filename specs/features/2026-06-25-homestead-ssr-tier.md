# Spec: Homestead Build-Free Surface Tier + dgk admin (superseded)

**Status:** Superseded by ADR-072 on 2026-06-29
**Authors:** Arthur Silva
**Date:** 2026-06-25
**Superseded by:** `specs/ADRs/ADR-072-consumer-leaf-distribution-policy.md`
**Canonical surface:** `@refarm.dev/ds/html`

---

## Outcome

This spec is intentionally archived as a tombstone. Do not implement
`@refarm.dev/homestead/ssr` or restore `@refarm.dev/homestead-ssr`.

ADR-072 moved build-free HTML helpers to `@refarm.dev/ds/html` because the
helpers are DS-owned presentational primitives, not Homestead runtime or shell
integration. Homestead remains responsible for richer SDK/shell/runtime
composition. `ds/html` is the canonical helper surface for build-free admin,
Lab, and generated HTML consumers.

## Why The Original Direction Was Rejected

The original 2026-06-25 direction proposed a Homestead-owned SSR/string tier for
simple admin pages such as `dgk serve`. That would have kept the implementation
build-free, but the name and owner were wrong:

- `ssr` suggested server-only rendering even though the helpers are isomorphic
  HTML string utilities.
- `homestead` suggested dependency on the shell/runtime SDK even though the
  helpers only need DS classes and tokens.
- keeping `@refarm.dev/homestead-ssr` or `@refarm.dev/homestead/ssr` as
  compatibility surfaces would create pre-publication compatibility debt.

## Replacement Path

Use `@refarm.dev/ds/html` directly.

Consumers keep product routes, command labels, copy, and workflow ownership.
Refarm supplies the DS-owned HTML helpers, token CSS, and package acceptance
rules. Any future Homestead build-free surface must prove it owns shell/runtime
integration that cannot live in DS; it must not recreate generic DS HTML
helpers under a Homestead name.

## Guardrails

- Do not add `@refarm.dev/homestead-ssr` back to `vault-seed-ready`.
- Do not add a `@refarm.dev/homestead/ssr` compatibility subpath.
- Do not direct `vault-seed` or `agents-lab` to import Homestead for DS-only
  HTML helpers.
- If a consumer needs build-free markup over DS classes, start from
  `@refarm.dev/ds/html`.
