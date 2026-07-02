# Launch Process Provenance Bridge (Item 8c) Implementation Plan

> Spec: `specs/features/2026-06-26-process-handoff-provenance-bridge.md`.
> Goal: prove `dgk-runner`-style process injection can become Refarm artifact
> provenance without importing downstream command vocabulary.

## Task 1 - Refarm-Side Proof

- Add a `process-handoff` test that creates a `ProcessHandoffSpec` from
  runner-style `(command, args, options)`.
- Use the same object as `ArtifactProvenance.process` inside a
  `TaskArtifactManifest`.
- Validate with `validateTaskArtifactManifest`.

## Task 2 - Package Boundary

- Keep the proof in `@refarm.dev/process-handoff`; do not make
  `artifact-contract-v1` depend on `@refarm.dev/process-handoff`.
- Keep `@refarm.dev/cli/process-handoff` as a compatibility re-export so existing
  Refarm callers keep working.
- Add `@refarm.dev/artifact-contract-v1` as a process-handoff test/dev
  dependency only.

## Task 3 - Documentation Handoff

- Mark 8c as Refarm-side proof ready.
- Mark `@refarm.dev/process-handoff` as the `vault-seed-ready` leaf instead of
  selecting the full CLI dependency closure.
- Keep official `dgk-runner` adoption downstream until the outside
  `vault-seed` checkout imports the SDK internally, preserves the exported
  `run(cmd, args, opts)` API and `dgk` UX, and emits manifests from its runner.

2026-06-26 packet:
- Candidate tarball:
  `.refarm/handoff/vault-seed/2026-06-26/refarm.dev-process-handoff-0.1.0.tgz`
  (`sha256 28b13b6e1dc8ab5cbdfbb6b671f73cf0ff849881957a6b81710044d95d43d466`).
- Tarball contents are limited to `dist/`, `package.json`, `README.md`, and
  `LICENSE`.
- `pnpm run release:vault-seed:check` passes with `@refarm.dev/process-handoff`
  included and the full `@refarm.dev/cli` dependency closure excluded.
