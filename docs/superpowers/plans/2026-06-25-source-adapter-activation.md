# Plan: Source Adapter Activation (Roadmap Item 7)

> Spec: `specs/features/2026-06-25-source-adapter-activation.md`.
> Goal: provide the activation playbook for `source-dispatch`, `source-local`, or `source-tarball`
> without implementing them before a consumer exists.

## Task 1 - Confirm Trigger

- Identify which adapter is needed and name the consumer.
- Record why `source-git` is insufficient.
- Gate: one trigger, one adapter.

## Task 2 - Adapter Spec Slice

- Write the focused spec for the selected adapter.
- Include provenance, dirty-state/hash policy, conformance wiring, and consumer proof.
- Gate: no combined multi-adapter implementation plan.

## Task 3 - Conformance Wiring

- Reuse the `source:v1` conformance suite.
- Add package acceptance entries only for the selected adapter.

## Task 4 - Consumer Proof

- Demonstrate the named consumer using the adapter.
- Record the fallback path if the adapter is unavailable.

## Non-Goal

Do not build item 7 until a named consumer triggers it.
