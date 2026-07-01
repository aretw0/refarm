# Feature: Tool-less Orchestrator Proof

**Status**: first proof implemented  
**Date**: 2026-07-01  
**Home**: `validations/toolless-orchestrator-proof`

## Context

The peerd research exposed a sharper runtime boundary than ordinary capability
filtering: the component that holds operator keys should not also own the
environment tools. Refarm already has capability policy, sandbox lessons, and
environment ceilings, but the runtime conductor can still be understood too
broadly if we do not name this split.

This proof isolates the third deep candidate from the verification-as-completion
work. Verification-as-completion asks whether "done" is backed by evidence. The
tool-less orchestrator asks whether the actor that gathers evidence can ever
reach operator keys.

## Decision

Add a proof-local harness with these schemas:

- `refarm.toolless-orchestrator.proof.v1`: the complete local proof packet.
- `refarm.toolless-orchestrator.delegation-request.v1`: a bounded request that
  carries capability names, policy, and source refs, not secret material.
- `refarm.toolless-orchestrator.fenced-evidence.v1`: actor-produced evidence
  that excludes operator keys, ambient shell, and unbounded egress.
- `refarm.toolless-orchestrator.conductor-decision.v1`: the key-holding
  conductor verifies evidence and decides without executing environment tools.

The invariant is:

1. conductor may hold operator keys;
2. conductor has zero environment tool capabilities;
3. actor has bounded environment tool capabilities;
4. actor is keyless and holds no operator keys;
5. request does not carry secret material;
6. conductor completes only after fenced evidence and source hash checks pass.

## Boundary

This does not create a package, mutate `pi-agent`/`farmhand`, add a global shell
proxy, publish npm packages, or move policy into `apps/refarm`.

Candidate homes remain runtime conductor internals, `process-handoff`,
environment ceilings, and future worker/session contracts if dogfood or a
second consumer proves stable package pressure.

## Acceptance

```bash
pnpm run toolless-orchestrator:poc:test
```

The proof must show:

- completion succeeds when conductor has no tools and actor is keyless;
- completion blocks if the conductor owns environment tools;
- completion blocks if a request asks for capabilities outside the actor bound;
- completion blocks if a request carries secret material;
- the proof stays local, with no package extraction or app-owned policy.
