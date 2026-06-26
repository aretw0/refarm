# Launch Process Provenance Bridge (Item 8c) Implementation Plan

> Spec: `specs/features/2026-06-26-launch-process-provenance-bridge.md`.
> Goal: prove `dgk-runner`-style process injection can become Refarm artifact
> provenance without importing downstream command vocabulary.

## Task 1 - Refarm-Side Proof

- Add a `launch-process` test that creates a `LaunchProcessSpec` from
  runner-style `(command, args, options)`.
- Use the same object as `ArtifactProvenance.process` inside a
  `TaskArtifactManifest`.
- Validate with `validateTaskArtifactManifest`.

## Task 2 - Package Boundary

- Keep the proof in `@refarm.dev/cli`; do not make
  `artifact-contract-v1` depend on `@refarm.dev/cli`.
- Add `@refarm.dev/artifact-contract-v1` as a CLI test/dev dependency only.

## Task 3 - Documentation Handoff

- Mark 8c as Refarm-side proof ready.
- Keep official `dgk-runner` adoption downstream until the outside
  `vault-seed` checkout emits manifests from its runner.
