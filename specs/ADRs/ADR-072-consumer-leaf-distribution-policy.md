# ADR-072: Consumer Leaf Distribution Policy

**Status**: Accepted
**Date**: 2026-06-29
**Authors**: Arthur Silva, Codex
**Related**: ADR-046 (Blocks and Distros), ADR-069 (npm scope canonicalization),
`docs/decision-log.md`, `refarm.config.json`

---

## Context

Refarm is becoming the upstream supplier for `vault-seed`, `agents-lab`, and its own dogfood
surfaces. That makes package boundaries more important than local convenience:

- consumer packages should import Refarm blocks without pulling Refarm app/runtime closures;
- package names must describe reusable capability, not the first consumer that exposed the need;
- compatibility subpaths are useful, but they must not hide install, license, or cadence coupling.

Two concrete signals triggered this decision:

- `@refarm.dev/homestead-ssr` exposes pure DS HTML helpers. The helpers are isomorphic, browser-safe,
  and do not require Homestead. The `-ssr` suffix and Homestead ownership both mislead consumers.
- `@refarm.dev/process-handoff` is a light process primitive re-exported by `@refarm.dev/cli`.
  Folding it into CLI would couple consumers to the CLI package's heavier runtime closure and
  different distribution posture.

## Decision

Refarm will keep **consumer-pulled leaf packages or subpaths owned by the lightest correct domain**.

The canonical owner of a reusable capability is the package that already owns its lowest-level
contract:

- DS-owned presentational HTML helpers belong at `@refarm.dev/ds/html`.
- Homestead owns runtime/shell/studio integration, not DS-only HTML string helpers.
- CLI owns operator commands and binaries, not generic process handoff primitives.

Pre-release compatibility re-exports should be removed when they only preserve misleading names.
Release lanes and new docs must point to the canonical light surface.

### Leaf vs parent rule

A light surface must stay outside the parent package when the parent has any of these properties:

- materially heavier install closure;
- different license or publication risk;
- runtime, storage, sync, Astro, Tractor, app-shell, or binary dependencies unrelated to the leaf;
- consumer cadence that should not be blocked by the parent package.

A parent subpath is acceptable only when importing or installing the parent does not pull unrelated
runtime closure and does not change the consumer's license/distribution posture.

### Homestead/DS outcome

`@refarm.dev/ds/html` is the canonical public surface for build-free DS HTML helpers.

`@refarm.dev/homestead-ssr` and `@refarm.dev/homestead/ssr` are removed pre-publication instead of
kept as compatibility surfaces. They should not be promoted in `vault-seed-ready`, because the names
incorrectly suggest server-only rendering and Homestead ownership.

### Process outcome

`@refarm.dev/process-handoff` must not become a `@refarm.dev/cli`-only subpath.

The capability-oriented package name is `@refarm.dev/process-handoff`, with CLI access exposed only
as a re-export. That name matches the package's actual role: tokenized process specs, runner
adaptation, detached execution, and artifact/provenance handoffs.

## Consequences

### Positive

- Consumer repos can import Refarm primitives without inheriting app/runtime dependencies.
- DS becomes the source of truth for DS class HTML helpers.
- Homestead's purpose stays clearer: rich shell/runtime SDK rather than generic HTML string helper.
- CLI does not become the accidental namespace for process primitives needed by non-CLI consumers.

### Negative

- `vault-seed-ready` package counts and historical handoff docs change.
- Pre-release consumers using `@refarm.dev/homestead-ssr` need to switch to `@refarm.dev/ds/html`.
- The rename from `launch-process` to `process-handoff` is a breaking import change for consumers
  that adopted the pre-release leaf.

### Risks

- Reintroducing compatibility re-exports would preserve the old vocabulary. Mitigation: release
  policy, package exports, and current docs point only to canonical surfaces.
- Moving too much into DS could make it less focused. Mitigation: DS may own generic HTML over DS
  classes, but domain routing, copy, workflows, and runtime state stay in host packages.

## Implementation

1. Add `@refarm.dev/ds/html` and validate it as part of the DS public API.
2. Remove `@refarm.dev/homestead-ssr` from `vault-seed-ready` release selection.
3. Remove Homestead SSR package/subpath surfaces before public release; downstream users should adopt
   `@refarm.dev/ds/html` directly.
4. Update current docs and handoff metadata so `ds/html` is the canonical static document helper.
5. Rename `@refarm.dev/launch-process` to `@refarm.dev/process-handoff` and keep CLI access as a
   `@refarm.dev/cli/process-handoff` re-export.
