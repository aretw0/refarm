# Convergence Factory Readiness

> Status: readiness ledger (2026-06-25). This document answers the stop-the-line question: when an
> implementer picks a convergence item, is there enough carpet laid down to execute without
> redesigning the work mid-build?

## Summary

Not everything is planned to execution depth yet. The safe state is:

| Item | Factory state | What is closed | What still stops execution |
|---|---|---|---|
| 4a `ds` tokens | ready to implement from plan | contract, scoping, themes, conformance, consumer proof | none after following the plan |
| 4b `homestead/ssr` | ready after 4a | subpath, helper API, build-free boundary, consumer proof | waits for 4a `ds` classes/tokens |
| 4c `silo` collect | ready to implement independently | contract boundary, namespaces, app re-export strategy | storage adoption by `vault-seed` remains item 8 |
| 4d `dispatch-surface` external API | not ready | need is identified by audit | missing spec; do not implement yet |
| 5 WASM substrate | POC-ready, not product-ready | ADR-070 Parts A/B; Part C gate | POC evidence for Astro SSR on Tractor |
| 6 gardening skills | discovery-ready only | taxonomy | skill runtime/engine dogfood gate not present |
| 7 librarian completion | correctly deferred | source:v1 base contract | waits for dispatch consumer or live-tree consumer |
| 8 consumer bridges | correctly deferred | silo collect is specified | each bridge needs a second consumer and its own spec |
| 9 executable specs | partially automated | package gate registration generator | cross-file codemods still need specs |

## Item 4 - UI and Surface Blocks

Execution order:

1. 4a `ds` token contract - follow
   `docs/superpowers/plans/2026-06-25-ds-token-contract.md`.
2. 4b `homestead/ssr` - follow
   `docs/superpowers/plans/2026-06-25-homestead-ssr-tier.md`; do not start before 4a has the
   token contract and component classes.
3. 4c `silo` collect - follow
   `docs/superpowers/plans/2026-06-25-silo-collection-contract.md`; can proceed independently of
   4a/4b if package build order stays green.
4. 4d `dispatch-surface` external-consumer API - write a feature spec before code. The audit says
   `dispatch-surface` is already a mature internal block, but no external API stabilization spec
   exists yet.

4d spec checklist:

- inventory current `apps/refarm` consumers of `dispatch-surface` and `homestead` action/rendering
  helpers;
- decide the public import surface and which APIs stay internal;
- identify one non-Refarm or headless Refarm consumer proof;
- add tests that import only the public surface;
- document package acceptance and changeset requirements.

## Item 5 - WASM Substrate

ADR-070 is enough to avoid re-arguing direction, but not enough to build a product surface. The
next executable artifact is the POC plan:

- `docs/superpowers/plans/2026-06-25-astro-wasi-ssr-poc.md`.

Decision rule:

- green POC: write a Part C feature spec for an Astro-on-Tractor adapter;
- red POC: record the blocker in ADR-070 and keep Parts A/B as the accepted direction;
- either way: do not block item 4 on item 5.

## Item 6 - Gardening Skills

The taxonomy is enough for strategy, not implementation. The missing prerequisite is a Refarm
skill invocation surface. Until that exists, creating a `dgk-skills` adapter would be supply ahead
of consumption.

Activation trigger:

- Refarm can load and invoke a skill-like manifest or command surface;
- one existing `dgk-skills` skill is chosen as the dogfood consumer;
- the adapter spec proves `dgk-skills` remains canonical in `vault-seed` and only conforms to the
  Refarm runtime.

First adapter spec sections when the trigger fires:

1. `SKILL.md` metadata mapping to the Refarm manifest.
2. Input/output envelope for read/search/create/admin skills.
3. Engine calls (`source:v1`, `context-provider-v1`, `sower`, `thresher`, `homestead`).
4. Compatibility test that runs one `dgk` skill through the Refarm surface.

## Item 7 - Librarian Completion

Keep deferred. It is not missing planning; it is missing consumption pressure.

Activation triggers:

- `source-dispatch`: an agent/kernel path needs to invoke `source:v1` through `dispatch-surface`;
- `source-local`: a consumer needs live local tree reads instead of clean git materialization;
- `source-tarball`: cross-repo consumption needs reproducible archive input.

When a trigger appears, write a feature spec and plan for exactly one adapter. Do not bundle all
three adapters into one implementation branch.

## Item 8 - Consumer Bridges

Keep deferred, but split it so the next implementer does not have to rediscover the seams:

| Bridge | Trigger | First spec should prove |
|---|---|---|
| 8a `vault-seed` `silo.js` -> `@refarm.dev/silo` | `silo` collect exists and a second consumer needs the same storage/provision boundary | namespaces preserve model/runtime/channel/publishing separation |
| 8b `contacts` + `rate-limiter` | another consumer needs publishing-channel identity/rate limits | channel concepts are consumer-neutral, not DGK-specific |
| 8c `cli/launch-process` | another CLI needs the same process-launch lifecycle | process helper is not coupled to `dgk` command names |

Spec rule: each bridge gets its own feature spec and its own consumer proof. A bridge does not
start because it is convenient; it starts because the second consumer exists.

## Codemod Discipline

Codemod or generator work is warranted only when the transform is repeatable or cross-file enough
that manual editing is riskier:

- already automated: package gate registration and changeset creation in `turbo gen package`;
- next codemod candidates: ADR-069 publish-target scope sweep, `CredentialProvider` import
  re-homing, `ds` token adoption in consumer CSS, and generated-vault manifest/inventory wiring;
- not codemods: ADR decisions, one-off prose, and speculative research notes.
