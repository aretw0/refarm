# Homestead Build-Free SSR Tier Plan (superseded)

**Status:** Superseded by ADR-072 on 2026-06-29.
**Superseded by:** `specs/ADRs/ADR-072-consumer-leaf-distribution-policy.md`
**Canonical surface:** `@refarm.dev/ds/html`

---

## Do Not Execute

This plan is archived as a tombstone. It is intentionally not an executable
checklist anymore.

Do not create, publish, pack, or document these surfaces:

- `@refarm.dev/homestead-ssr`
- `@refarm.dev/homestead/ssr`

The implementation direction changed before public release. The build-free
HTML helper capability now belongs to `@refarm.dev/ds/html`, because it emits
DS classes/tokens and does not need Homestead shell/runtime dependencies.

## Replacement Work

Use the DS-owned path instead:

- package/subpath: `@refarm.dev/ds/html`
- decision: `specs/ADRs/ADR-072-consumer-leaf-distribution-policy.md`
- current supply map: `docs/ECOSYSTEM_SUPPLY_MAP.md`
- distribution status: `packages/DISTRIBUTION_STATUS.md`

Consumers such as `vault-seed` should import `@refarm.dev/ds/html` directly for
build-free admin or Lab HTML. Product routes, command names, copy, and local UX
remain downstream-owned.

## Historical Note

The original plan explored a Homestead-owned SSR/string tier for `dgk serve`.
That was useful pressure, but the final boundary is stricter: DS owns generic
presentational HTML helpers, and Homestead owns richer shell/runtime
composition. Keeping the old compatibility names would add pre-publication
maintenance burden without serving a real external compatibility need.
