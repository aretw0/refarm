# Convergence Factory Readiness

> Status: readiness ledger (2026-06-25). This document answers the stop-the-line question: when an
> implementer picks a convergence item, is there enough carpet laid down to execute without
> redesigning the work mid-build?

## Summary

Not everything is planned to execution depth yet. The safe state is:

| Item | Factory state | What is closed | What still stops execution |
|---|---|---|---|
| 4a `ds` tokens | **implemented** (Tasks 1–5 committed in `packages/ds/src`) | contract, scoped tokens, 4 themes, theme-conformance, component classes, CSS exports | gate not yet re-verified by the steward (needs full env / `farm`); then pack → Lab consumer-proof |
| 4b `homestead/ssr` | **bite-sized plan ready** (after 4a) | subpath, helper API, build-free boundary, consumer proof, TDD steps + code | waits for 4a `ds` classes/tokens |
| 4c `silo` collect | **bite-sized plan ready** (independent) | contract boundary, namespaces, namespaced secret store, app re-export, TDD steps + code | storage adoption by `vault-seed` remains item 8 |
| 4d `dispatch-surface` external API | **bite-sized plan ready** | public API lock test, headless consumer proof, parity gate | none — execute the plan |
| 5 WASM substrate | POC-ready, not product-ready | ADR-070 Parts A/B; Part C gate | POC evidence for Astro SSR on Tractor |
| 6 gardening skills | activation-gated | taxonomy; activation spec+plan | skill runtime/engine dogfood gate not present |
| 7 librarian completion | correctly deferred | source:v1 base contract | waits for dispatch consumer or live-tree consumer |
| 8 consumer bridges | partially activated | `silo`, `cli/launch-process`, and channel-control seams are specified | 8a waits for 4c; 8b needs channel-policy spec; 8c needs runner/provenance proof |
| 9 executable specs | partially automated | package gate registration generator; vault-seed generator spec+plan; codemod registry spec+plan | first registry implementation still needed |
| 10 `io_uring` substrate | POC-ready, not product-ready | Linux async I/O hypothesis, workload candidates, fallback rule | evidence from Refarm-shaped workload |
| 11 XR/WebXR surface | POC-ready, not product-ready | WebXR/A-Frame/three.js posture; fallback rule | browser/device evidence from a contained surface POC |

| Cross-cutting item | Factory state | What is closed | What still stops execution |
|---|---|---|---|
| npm scope docs sweep | done | ADR-069 accepted; Refarm publish-target docs now use `@refarm.dev` | none |

## Plan depth — read before "ready to implement"

Two plan depths exist; do not confuse them:

- **Bite-sized executable plans** (TDD steps + complete code, per `superpowers:writing-plans`):
  the librarian (`docs/superpowers/plans/2026-06-24-source-contract-v1.md`) and the whole **item-4
  family** — **4a `ds`**, **4b `homestead/ssr`**, **4c `silo` collect**, **4d `dispatch-surface`
  external API** (the `2026-06-25-*` plans). Open and execute step by step.
- **Concrete first-artifact plans** (the contract/manifest is real; the runtime iterates or gates):
  **9a** (manifest-first — the file classification is derived verbatim from
  `vault-seed/.github/workflows/initialize.yml`) and **9b** (registry-first — the four candidate
  entries seeded; codemod implementations gated per entry).
- **Task-level plans** (task decomposition + gates, paired with a **code-rich spec** that carries
  the interfaces): the remaining gated/POC items (5, 6, 7, 8, 10, 11). These are *not* line-by-line
  code — expand at pickup.

Execution model for the task-level ones: **just-in-time expansion** — when you pick an item,
invoke `superpowers:writing-plans` on its spec to generate the bite-sized plan, then execute. Do
**not** pre-expand all items (specs may still shift; pre-expanding deferred work is waste). In the
tables below, "ready to implement from plan" for a task-level item means "spec + task plan are
solid enough that `writing-plans` yields a clean bite-sized plan", **not** "type code from the
plan file". The two bite-sized items are the exception: no expansion step needed.

## v0.1 Consumer-Pulled Acceleration Rule

`vault-seed` is now an active consumer proof for v0.1.0 blocks. Do not interpret
"daily driver first" as "downstream keeps rebuilding local copies until Refarm is
publicly released." For any block already needed by `vault-seed`, the factory
sequence is:

1. implement and test the Refarm block;
2. prove Refarm consumes it or record a narrow consumer-pulled exception;
3. expose a candidate consumption path: packed package, manifest generator, or
   codemod dry-run;
4. prove `vault-seed` can consume it while keeping product behavior downstream;
5. promote only after the proof records command, fallback, rollback, and missing
   semantics.

This rule activates work that prevents migration churn:

| Lane | Active proof | Stops when |
|---|---|---|
| UI blocks | `ds` -> `homestead/ssr` -> `vault-seed` Lab/admin adoption | token/SSR conformance or consumer proof fails |
| Process/artifacts | `cli/launch-process` + `artifact-contract-v1` -> `dgk-runner`/Lab evidence | process vocabulary becomes DGK-specific |
| Channels/outbox | `dgk-channels` + Telegram outbox/inbox -> channel policy evidence over Refarm channel-control surfaces | Telegram API, note UX, or DGK command names leak into Refarm |
| Lab/artifacts | Lab dataset/outbox/notebook manifests -> artifact/provenance envelopes | notebook UX or vault schema moves upstream |
| Template/generation | generated-vault smoke + initialize reset -> vault generator/codemod registry | generator cannot distinguish payload from template-dev-only files |
| Release/package checks | package smoke, version, lockfile/integrity checks -> release-engine/package acceptance policy | Refarm policy hardcodes DGK package names |
| Health/substrate checks | action pins, substrate, generated-output, devcontainer contract checks -> health/environment substrate | project-local allowances become global rules |
| Credentials | `silo` collect -> `vault-seed` `silo.js` bridge after 4c | namespaces collapse or app provider re-export is not stable |
| Text quality | text scoring scripts -> text-quality contract/config | submission/vault rubric moves upstream |

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
4. 4d `dispatch-surface` external-consumer API - follow
   `docs/superpowers/plans/2026-06-25-dispatch-surface-external-api.md`.

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

Activation packet:

- `specs/features/2026-06-25-skill-runtime-activation.md`;
- `docs/superpowers/plans/2026-06-25-skill-runtime-activation.md`.

## Item 7 - Librarian Completion

Keep deferred. It is not missing planning; it is missing consumption pressure.

Activation triggers:

- `source-dispatch`: an agent/kernel path needs to invoke `source:v1` through `dispatch-surface`;
- `source-local`: a consumer needs live local tree reads instead of clean git materialization;
- `source-tarball`: cross-repo consumption needs reproducible archive input.

When a trigger appears, write a feature spec and plan for exactly one adapter. Do not bundle all
three adapters into one implementation branch.

Activation packet:

- `specs/features/2026-06-25-source-adapter-activation.md`;
- `docs/superpowers/plans/2026-06-25-source-adapter-activation.md`.

## Item 8 - Consumer Bridges

Split the bridges so activation is evidence-based rather than a general cleanup bucket:

| Bridge | Trigger | First spec should prove |
|---|---|---|
| 8a `vault-seed` `silo.js` -> `@refarm.dev/silo` | **Activated after 4c**: `apps/refarm` providers and `vault-seed` both need the same namespaced collect boundary | namespaces preserve model/runtime/channel/publishing separation |
| 8b channel policy (`contacts` + `rate-limiter` + receipts) | **Candidate active**: `vault-seed` Telegram outbox/inbox and Refarm channel-control surfaces both need destination, rate-limit, delivery state, receipt, dry-run, and review semantics | channel concepts are consumer-neutral, not Telegram- or DGK-specific |
| 8c `cli/launch-process` + artifact provenance | **Candidate active**: `dgk-runner` and Refarm process handoffs share tokenized process evidence | process helper is not coupled to `dgk` command names |

Spec rule: each bridge gets its own feature spec and its own consumer proof. A bridge does not
start because it is convenient; it starts because the second consumer exists. `vault-seed` counts
as that consumer only for the specific primitive it already duplicates.

For 8b, keep the first package boundary conservative: one channel-policy/evidence contract is
preferable to prematurely splitting `contacts` and `rate-limiter`. Split only when conformance
tests show the subdomains need independent versioning.

## Additional Downstream Assimilation Backlog

These are not new top-level roadmap items; they are pressure signals to attach
to the existing lanes before `vault-seed` grows more local substrate:

| Pressure | Attach to | Next planning move |
|---|---|---|
| Lab dataset/outbox/notebook manifests | `artifact-contract-v1`, WASM substrate | Add consumer proof requirements to item 9a or the next artifact-contract review. |
| Generated-vault smoke/reset/template inventory | vault generator + codemod registry | Keep active; this is the boilerplate-killing lane. |
| Release package smoke, lockfile template sync, version contracts | `release-engine`, package acceptance checklist | Plan a release-policy consumer proof after generator inventory exists. |
| Action pinning, substrate/devcontainer checks, generated-output hygiene | `health` / environment substrate | Extract only rules that can be expressed as consumer policy. |
| Text scoring and prose quality reports | text-quality contract/config | Keep Refarm scoring generic; leave Portuguese/vault dashboards downstream. |
| Astro wiki/callout/image transforms | future content-transform contract | Hold until a second non-vault consumer repeats the same transforms. |

## Roadmap-Derived Assimilation Backlog

The explicit `vault-seed` roadmap adds more supply pressure. These entries do
not create new top-level items until a spec activates them, but they prevent the
factory from stopping later to re-decide ownership.

| Roadmap pressure | Attach to | Activation trigger |
|---|---|---|
| `lab.sources.json`, `ExtractionProfile`, cache/staging, data lifecycle | item 1/7 source adapters + artifact retention policy | second extractor or generated vault needs the same source/profile shape |
| `target: "auto"` AI placement | model/task contract + artifact evidence | classifier decisions need replay, review, or provider swap |
| Mastodon/Bluesky/Instagram/newsletter/Nostr parity | 8b channel policy + `silo` identity namespace | second provider proves the same destination/rate-limit/receipt/review envelope |
| Nostr kind 30023 through Refarm identity | identity + channel-policy proof | signed delivery evidence can be expressed without vault article semantics |
| `dgk publish workspace` and custom distributions | item 9 generator/codemod + release-engine | generated vault smoke needs package/workspace publication metadata |
| OKF/JSON-LD/semantic graph export | future knowledge/content manifest contract | another consumer wants the same graph/content envelope |
| changelog as publishable content | release-engine + channel policy | release notes can emit an outbox-ready artifact without editorial takeover |
| Lab WASM HTTP/OpenGraph helpers and refresh workflows | item 5 WASM substrate + source HTTP readers + artifacts | Marimo/Astro need the same browser-safe data helper contract |
| `vault-publish`, `vault-inbox`, `vault-changelog` skills | item 6 skill runtime activation | a skill can run through Refarm primitives without rewriting DGK SKILL.md |

Keep the first implementation conservative: prefer one neutral envelope with conformance tests
over splitting packages by wish list. Split only when the tests show independent versioning,
runtime, or ownership.

Activation packet:

- `specs/features/2026-06-25-consumer-bridges-activation.md`;
- `docs/superpowers/plans/2026-06-25-consumer-bridges-activation.md`.

## Codemod Discipline

Codemod or generator work is warranted only when the transform is repeatable or cross-file enough
that manual editing is riskier:

- already automated: package gate registration and changeset creation in `turbo gen package`;
- next codemod candidates: ADR-069 publish-target scope sweep, `CredentialProvider` import
  re-homing, `ds` token adoption in consumer CSS, and generated-vault manifest/inventory wiring;
- not codemods: ADR decisions, one-off prose, and speculative research notes.

Vault-seed generator classification:

- generator actions: payload copy, template-dev file exclusion, deterministic rename, generated
  `inventory.json`, welcome-note status publication, and the current `vault.config.json` kudos
  removal/license-holder fill. These are local, idempotent, and covered by the generated-vault
  smoke boundary.
- codemod candidates: repository identity/package metadata rewrites, package-name/workspace
  adoption, and any future cross-file JSON/TS/CSS rewrite needed by more than one generated vault
  or consumer checkout.
- still not codemods: Markdown prose choices and ADR/spec content. Promote them only after a
  repeatable structural rule exists.

## Item 9a - Vault-Seed Generator

The generator-first direction now has a spec and plan:

- `specs/features/2026-06-25-vault-seed-generator-contract.md`;
- `docs/superpowers/plans/2026-06-25-vault-seed-generator-contract.md`.

Start with manifest + inventory before copying files. The first proof is a generated vault that
passes the selected `vault-seed` smoke gate, not a hand-authored duplicate of the template.

## Item 9b - Codemod Registry

The codemod-first direction now has a registry contract before any new platform work:

- `specs/features/2026-06-25-codemod-registry-contract.md`;
- `docs/superpowers/plans/2026-06-25-codemod-registry-contract.md`.

Start with metadata, fixtures, dry-run command, and rollback note. Do not create a hosted registry
or MCP integration until at least two entries prove repeatable value.

## Item 10 - Linux Async I/O (`io_uring`)

`io_uring` is worth tracking because Refarm has native Rust hot paths and agent workloads that can
be file/socket heavy. It is not a cross-platform default and must not leak into TS public APIs.

Spec and plan:

- `specs/features/2026-06-25-io-uring-substrate.md`;
- `docs/superpowers/plans/2026-06-25-io-uring-substrate.md`.

Start only as a validation under `validations/io-uring-substrate/`. The first gate is not raw
throughput; it is capability probe + fallback + a meaningful win on a Refarm-shaped workload.

## Item 11 - XR/WebXR Surface

XR is a frontier surface, not a core dependency:

- `specs/features/2026-06-25-xr-surface-poc.md`;
- `docs/superpowers/plans/2026-06-25-xr-surface-poc.md`.

The first gate is equal data across 2D fallback and XR scene. A-Frame or three.js stays isolated to
the POC until graduation evidence exists.
