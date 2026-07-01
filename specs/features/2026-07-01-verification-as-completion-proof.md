# Feature: Verification As Completion Proof

**Status**: first proof implemented  
**Date**: 2026-07-01  
**Home**: `validations/verification-as-completion`

## Context

The peerd, RTK, and Terax research points at one missing runtime discipline:
completion should not be a model or runner claim. It should be a decision backed
by re-observed evidence.

RTK adds the observation membrane: compact command output is useful, but raw
evidence must remain recoverable. Terax adds structured terminal/agent signals.
Accordion reinforces that `context:v1` needs reversible context maps, not
destructive summaries. Peerd makes the sharpest rule: the source of truth
arbitrates whether work is done.

## Decision

Add a proof-local validation before extracting any package:

- `tool-observation.proof.v1`: command, exit status, compact view, raw evidence
  pointer, redaction policy, and observed source hash.
- `verification-evidence.proof.v1`: re-observes the source ref and hash.
- `completion-decision.proof.v1`: returns `completed` only when the command
  succeeded and verification evidence passed.
- `toolless-delegation.proof.v1`: a key-holding conductor owns no environment
  tools; a keyless actor owns bounded tools and returns fenced evidence.
- `context-map.proof.v1`: points at existing `context:v1` /
  `@refarm.dev/context-provider-v1` reversible fold semantics.

## Boundary

This does not create a new public contract yet. Candidate homes are
`effort-contract-v1`, `artifact-contract-v1`, `process-handoff`,
`context-provider-v1`, and a future `tool-observation:v1` only if dogfood or a
second consumer proves package pressure.

It also does not move logic into `apps/refarm`, publish npm packages, replace
the current agent runtime, or require a global shell proxy.

## Acceptance

```bash
pnpm run verification-completion:poc:test
```

The proof must show:

- completion is `completed` for matching source hash evidence;
- completion is `blocked` when the observed hash drifts;
- compact observation explicitly says it is not truth;
- raw evidence is recoverable;
- the conductor has zero tool capabilities;
- the actor is keyless;
- context points at existing `context:v1`.
