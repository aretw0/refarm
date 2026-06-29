# Spec: Source Adapter Activation (Roadmap Item 7)

**Status:** Partially activated — `source-local` implemented on 2026-06-29; `source-dispatch`
and `source-tarball` remain deferred
**Authors:** Arthur Silva
**Date:** 2026-06-25
**Related:** `specs/features/2026-06-24-source-contract-v1.md`, `docs/CONVERGENCE_ROADMAP.md` item 7

---

## Context & Motivation

`source:v1` and `source-git` are planned as the first librarian implementation. Item 7 is the
deferred completion layer: `source-dispatch`, `source-local`, and `source-tarball`. The deferral is
correct, but the activation path should not require rediscovering the boundary.

## Activation Rules

Build exactly one adapter when its trigger appears:

| Adapter | Trigger | First proof |
|---|---|---|
| `source-dispatch` | an agent/kernel path needs to invoke `source:v1` through `dispatch-surface` | dispatch call materializes a source through the same conformance suite |
| `source-local` | a consumer needs live dirty working-tree reads | ✅ `@refarm.dev/source-local` reports dirty/untracked state explicitly and runs the source:v1 conformance suite |
| `source-tarball` | reproducible archive input is needed for cross-repo consumption | tarball hash maps to deterministic file inventory |

Do not implement all adapters in one branch.

## Shared Requirements

- Each adapter depends on `source-contract-v1` and runs its conformance suite.
- Each adapter records provenance: source kind, source identity, resolved revision/hash if any,
  and dirty-state policy.
- Each adapter has a consumer proof before it becomes a recommended path.

## Out of Scope

- Replacing `source-git` as the default clean snapshot provider.
- Live mutation APIs. The librarian reads and materializes; it does not edit sources.
