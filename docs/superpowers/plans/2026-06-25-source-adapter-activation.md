# Plan: Source Adapter Activation (Roadmap Item 7)

> Spec: `specs/features/2026-06-25-source-adapter-activation.md`.
> Goal: provide the activation playbook for `source-dispatch`, `source-local`, `source-web`, or `source-tarball`
> without implementing them before a consumer exists.
> Status 2026-06-29: `source-local` has been activated as `@refarm.dev/source-local`; this plan now
> remains for `source-dispatch` and `source-tarball`. Status 2026-06-30:
> requirements-vault pressure activated `source-web` as `@refarm.dev/source-web`.

## Task 1 - Confirm Trigger

- [x] Identify which adapter is needed and name the consumer.
- [x] Record why `source-git` is insufficient.
- [x] Gate: one trigger, one adapter.

For `source-web`, the named consumer pressure is Work 3 requirements-vault:
requirements ingestion needs authenticated web capture evidence and offline
replay. `source-git` and `source-local` cannot represent session lifecycle,
pacing, cache redaction, or replay provenance.

## Task 2 - Adapter Spec Slice

- [x] Write the focused spec for the selected adapter.
- [x] Include provenance, dirty-state/hash policy, conformance wiring, and consumer proof.
- [x] Gate: no combined multi-adapter implementation plan.

`@refarm.dev/source-web` is implemented as a `source:v1` adapter that emits a
local snapshot (`location.kind = "local"`) with package-owned web provenance.
`source-contract-v1` remains unchanged.

## Task 3 - Conformance Wiring

- [x] Reuse the `source:v1` conformance suite.
- [x] Add package acceptance entries only for the selected adapter.

`pnpm --filter @refarm.dev/source-web run test` covers the source:v1 conformance
suite and fixture-specific provenance assertions.

## Task 4 - Consumer Proof

- Demonstrate the named consumer using the adapter.
- Record the fallback path if the adapter is unavailable.

## Non-Goal

Do not build item 7 until a named consumer triggers it.
