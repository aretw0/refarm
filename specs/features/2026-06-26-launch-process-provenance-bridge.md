# Spec: Launch Process Provenance Bridge (Roadmap Item 8c)

**Status:** ACTIVE - Refarm-side proof
**Date:** 2026-06-26
**Related:** `docs/VAULT_SEED_CONVERGENCE.md`,
`specs/features/2026-06-25-consumer-bridges-activation.md`

## Context

`dgk-runner` already exposes the useful seam: product commands accept an
injectable `(command, args, options) => Promise<void>` runner. Refarm already
ships `@refarm.dev/cli/launch-process`, which converts that shape into a
tokenized `LaunchProcessSpec`, and `@refarm.dev/artifact-contract-v1`, which
stores tokenized process evidence under `ArtifactProvenance.process`.

## Decision

Do not create a new runner package for 8c. The bridge is the compatibility
between:

- `createLaunchProcessSpecFromRunner` / `createLaunchProcessRunner` in
  `@refarm.dev/cli/launch-process`;
- `ArtifactProcessReference` in `@refarm.dev/artifact-contract-v1`;
- downstream product runners such as `dgk-runner`.

The first Refarm-side proof is a CLI package test that builds a runner process
spec and validates a `TaskArtifactManifest` carrying that exact process object
as provenance.

## Boundary

Refarm owns:

- shell-free tokenized process specs;
- process display consistency;
- artifact provenance validation.

Downstream owns:

- command names such as `dgk lab` or `dgk publish`;
- vault paths, notebooks, and ETL semantics;
- process output parsing beyond generic artifact/provenance evidence.

## Verification

- `packages/cli/src/launch-process-provenance.test.ts` proves a runner-style process spec
  validates as artifact provenance without shell-splitting.
- `@refarm.dev/cli` stays the process adapter package.
- `@refarm.dev/artifact-contract-v1` remains independent of the CLI package.

## Rollback

Downstream CLIs can continue using their injected runner unchanged. The Refarm
bridge is additive until the downstream runner elects to emit artifact manifests.
