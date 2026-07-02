# Spec: Source Adapter Activation (Roadmap Item 7)

**Status:** Partially activated — `source-local` implemented on 2026-06-29; `source-web`
implemented as a sanitized fixture adapter on 2026-06-30; `source-dispatch`
and `source-tarball` remain deferred
**Authors:** Arthur Silva
**Date:** 2026-06-25
**Related:** `specs/features/2026-06-24-source-contract-v1.md`,
`specs/features/2026-06-30-work-3-requirements-supply-activation.md`, `docs/CONVERGENCE_ROADMAP.md` item 7

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
| `source-web` | a requirements-vault proof needs a stable local snapshot of an authenticated web source | ✅ `@refarm.dev/source-web` materializes a sanitized fixture web source with session/cache provenance through the same conformance suite; no private target |

Do not implement all adapters in one branch.

## Authenticated web capture (`source-web`, T3 candidate)

`source-web` **converges on `source:v1`** — it is another adapter of the existing contract, not a new
contract and not a wrapper that changes it. `materialize` still means "give me a stable local
snapshot"; only the snapshot's origin differs (an authenticated web source instead of a git remote).
**`source-contract-v1` does not change**; this resolves the open "in `source:v1` vs a web-specific
wrapper" question recorded in `DISTRIBUTION_STATUS.md`.

What the adapter owns beyond `source-git`/`source-local`, exposed through provenance:

- **session/auth lifecycle evidence** — logged-in capture, token/cookie lifetime; credentials are
  resolved through `@refarm.dev/silo`, never embedded in the adapter;
- **pacing policy** — rate/backoff so capture is polite and reproducible;
- **cache identity and provenance** — content hash + captured-at, so a snapshot is auditable;
- **offline replay hooks** — a captured snapshot replays without the live source (required so
  sanitized fixtures and CI run without the target);
- **redaction** — strip secrets/PII from the cached snapshot before it is stored.

The consumer seam (stays downstream / in the private proof, never in `@refarm.dev/source-web`):

- `AuthStrategy` — how to log in to the real target;
- `TargetDescriptor` — URLs, selectors, and aliases of the real source;
- accessible-system discovery.

The adapter accepts these as injected inputs and passes the same `source:v1` conformance suite. First
proof: a local fixture web source with login/session evidence but no private target, mirroring the
First Proof Shape in the work-3 activation packet.

Implemented shape: `@refarm.dev/source-web` reports `location.kind = "local"`
because `source-contract-v1` remains unchanged. The package-owned result
provenance carries the authenticated web origin evidence: session, pacing,
cache hash/captured-at, offline replay, and redaction report.

## Shared Requirements

- Each adapter depends on `source-contract-v1` and runs its conformance suite.
- Each adapter records provenance: source kind, source identity, resolved revision/hash if any,
  and dirty-state policy.
- Each adapter has a consumer proof before it becomes a recommended path.

## Out of Scope

- Replacing `source-git` as the default clean snapshot provider.
- Live mutation APIs. The librarian reads and materializes; it does not edit sources.
