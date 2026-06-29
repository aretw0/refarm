# Spec: Launch Process Provenance Bridge (Roadmap Item 8c)

**Status:** ACTIVE - Refarm-side proof
**Date:** 2026-06-26
**Related:** `docs/VAULT_SEED_CONVERGENCE.md`,
`specs/features/2026-06-25-consumer-bridges-activation.md`

## Context

`dgk-runner` already exposes the useful seam: product commands accept an
injectable `(command, args, options) => Promise<void>` runner. Refarm now ships
`@refarm.dev/process-handoff`, which converts that shape into a tokenized
`ProcessHandoffSpec`, and `@refarm.dev/artifact-contract-v1`, which stores
tokenized process evidence under `ArtifactProvenance.process`.
`@refarm.dev/cli/process-handoff` remains a CLI re-export for existing
Refarm callers.

The downstream direction is SDK absorption, not CLI replacement: `dgk` keeps its
package names, binary, command vocabulary, paths, and user experience while
using Refarm primitives internally where they remove duplicated machinery.

## Decision

Create a leaf runner package for 8c so consumer projects can adopt the process
boundary without pulling the full CLI dependency closure. The bridge is the
compatibility between:

- `createProcessHandoffSpecFromRunner` / `createProcessHandoffRunner` in
  `@refarm.dev/process-handoff`;
- the CLI subpath `@refarm.dev/cli/process-handoff`;
- `ArtifactProcessReference` in `@refarm.dev/artifact-contract-v1`;
- downstream product runners such as `@aretw0/dgk-runner`.

The first Refarm-side proof is a leaf package test that builds a runner process
spec and validates a `TaskArtifactManifest` carrying that exact process object
as provenance.

## Boundary

Refarm owns:

- shell-free tokenized process specs;
- process display consistency;
- artifact provenance validation.

Downstream owns:

- command names such as `dgk lab` or `dgk publish`;
- the exported `run(cmd, args, opts)` runner API and package identity;
- vault paths, notebooks, and ETL semantics;
- process output parsing beyond generic artifact/provenance evidence.

## Verification

- `packages/process-handoff/src/index.test.ts` proves a runner-style process spec
  validates as artifact provenance without shell-splitting.
- `@refarm.dev/process-handoff` is the process adapter package selected by
  `vault-seed-ready`.
- `@refarm.dev/cli/process-handoff` stays as a CLI re-export.
- `@refarm.dev/artifact-contract-v1` remains independent of the process package.

## Rollback

Downstream CLIs can continue using their injected runner unchanged. The Refarm
bridge is additive until the downstream runner elects to import the SDK
internally and emit artifact manifests.
