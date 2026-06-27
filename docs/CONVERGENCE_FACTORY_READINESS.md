# Convergence Factory Readiness

> Status: readiness ledger (2026-06-25). This document answers the stop-the-line question: when an
> implementer picks a convergence item, is there enough carpet laid down to execute without
> redesigning the work mid-build?

## Summary

Not everything is planned to execution depth yet. The safe state is:

| Item | Factory state | What is closed | What still stops execution |
|---|---|---|---|
| 1 librarian `source:v1` | **implemented** | `@refarm.dev/source-contract-v1`, `@refarm.dev/source-git`, conformance, build, `test:capabilities`, and librarian smoke re-verified 2026-06-26 | downstream adapters remain item 7 and activate only when consumed |
| 4a `ds` tokens | **implemented** (Tasks 1–5 committed in `packages/ds/src`) | contract, scoped tokens, 4 themes, theme-conformance, component classes, CSS exports; focused package gate re-verified 2026-06-26 | broad steward/push gate and official `vault-seed` assimilation remain pending |
| 4b `homestead/ssr` | **implemented** | subpath, helper API, build-free boundary, consumer proof, package files constraint | downstream adoption proof remains consumer-side |
| 4c `silo` collect | **implemented** | contract boundary, namespaces, namespaced secret store, app re-export, acceptance wiring | storage adoption by `vault-seed` remains item 8a |
| 4d `dispatch-surface` external API | **implemented** | public API lock test, headless consumer proof, README contract, acceptance wiring | downstream bridge consumers remain item 7/8 work |
| 5 WASM substrate | POC-ready, not product-ready | ADR-070 Parts A/B; Part C gate | POC evidence for Astro SSR on Tractor |
| 6 gardening skills | activation-gated | taxonomy; activation spec+plan | skill runtime/engine dogfood gate not present |
| 7 librarian completion | correctly deferred | source:v1 base contract | waits for dispatch consumer or live-tree consumer |
| 8 consumer bridges | partially activated | 8a Refarm-side package proof and handoff are complete; 8b has the `channel-policy-v1` spec/package slice; 8c has the `launch-process` leaf -> artifact provenance proof | official `vault-seed` 8a adapter proof; official 8b downstream envelope proof; official 8c `dgk-runner` manifest proof |
| 9 executable specs | partially automated | package gate registration generator; vault-seed generator manifest/inventory; generator -> release-policy consumer proof; codemod registry; ready codemods (`ds-token-adoption`, `package-workspace-adoption`) | first official consumer runs of the ready codemods remain downstream |
| 10 `io_uring` substrate | probe started, not product-ready | Linux async I/O hypothesis, workload candidates, fallback rule, devcontainer capability probe | baseline materialization fixture; `io_uring` comparison only on a host/container that reports `available` |
| 11 XR/WebXR surface | POC started, not product-ready | WebXR/A-Frame/three.js posture, fallback rule, renderer-neutral fixture/probe | browser/device evidence from a contained static preview |

| Cross-cutting item | Factory state | What is closed | What still stops execution |
|---|---|---|---|
| npm scope docs sweep | done | ADR-069 accepted; Refarm publish-target docs now use `@refarm.dev` | none |
| release readiness | validated | `pnpm run release:readiness` passed on 2026-06-27; the plan includes the lightweight `reference-driver:smoke` gate before package dry-run, and publish dry-run is scoped to the release-policy default selection (`kernel-candidates`: `storage-contract-v1`, `sync-contract-v1`, `identity-contract-v1`, `channel-policy-v1`) | actual publication remains gated by daily-driver policy and repository/npm operator setup |
| `vault-seed` release lane | dry-run validated + handoff complete | `vault-seed-ready` selection lives in versioned `refarm.config.json`; `pnpm run release:vault-seed:check` passed on 2026-06-26 for 10 packages; `pnpm run release:vault-seed:handoff -- --json` now reports `acceptance.status: "accepted"` with 10 packages and 24 required checks; `.refarm/handoff/vault-seed/2026-06-26/` has matching tarballs for the full selection; `scripts/ci/test-vault-seed-release-consumer.mjs` proves generated-vault `@refarm.dev/*` dependencies are covered by `vault-seed-ready`; the lane selects leaf packages such as `@refarm.dev/homestead-ssr` and `@refarm.dev/launch-process` instead of full SDK/CLI closures | official downstream assimilation proofs remain pending |

## Plan depth — read before "ready to implement"

Two plan depths exist; do not confuse them:

- **Bite-sized executable plans** (TDD steps + complete code, per `superpowers:writing-plans`):
  the librarian (`docs/superpowers/plans/2026-06-24-source-contract-v1.md`) and the whole **item-4
  family** — **4a `ds`**, **4b `homestead/ssr`**, **4c `silo` collect**, **4d `dispatch-surface`
  external API** (the `2026-06-25-*` plans). Open and execute step by step.
- **Concrete first-artifact plans** (the contract/manifest is real; the runtime iterates or gates):
  **9a** (manifest-first — the file classification is derived verbatim from
  `vault-seed/.github/workflows/initialize.yml`) and **9b** (registry-first — two ready codemods;
  entries that were cheaper as manual/generator work are retired).
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
| Process/artifacts | `launch-process` + `artifact-contract-v1` -> `dgk-runner`/Lab evidence | process vocabulary becomes DGK-specific |
| Channels/outbox | `dgk-channels` + Telegram outbox/inbox -> channel policy evidence over Refarm channel-control surfaces | Telegram API, note UX, or DGK command names leak into Refarm |
| Lab/artifacts | Lab dataset/outbox/notebook manifests -> artifact/provenance envelopes; Refarm-side fixture and tarball packet ready | notebook UX or vault schema moves upstream |
| Template/generation | generated-vault smoke + initialize reset -> vault generator/codemod registry | generator cannot distinguish payload from template-dev-only files |
| Release/package checks | package smoke, version, lockfile/integrity checks -> release-engine/package acceptance summary; release-engine tarball handoff ready | Refarm policy hardcodes DGK package names |
| Health/substrate checks | action pins, substrate, generated-output, devcontainer contract checks -> health/environment substrate | project-local allowances become global rules |
| Credentials | `silo` collect -> `vault-seed` `silo.js` bridge after 4c | namespaces collapse or app provider re-export is not stable |
| Text quality | text scoring scripts -> text-quality contract/config | submission/vault rubric moves upstream |

## Item 4 - UI and Surface Blocks

Execution record:

1. 4a `ds` token contract - implemented via
   `docs/superpowers/plans/2026-06-25-ds-token-contract.md`.
2. 4b `homestead/ssr` - implemented via
   `docs/superpowers/plans/2026-06-25-homestead-ssr-tier.md`; public consumer lane uses
   the leaf package `@refarm.dev/homestead-ssr` so `vault-seed` can adopt the build-free
   helpers without installing the bundled Homestead SDK closure.
3. 4c `silo` collect - implemented via
   `docs/superpowers/plans/2026-06-25-silo-collection-contract.md`.
4. 4d `dispatch-surface` external-consumer API - implemented via
   `docs/superpowers/plans/2026-06-25-dispatch-surface-external-api.md`.

Remaining item-4 work is downstream adoption/proof, not block construction.

## Item 5 - WASM Substrate

ADR-070 is enough to avoid re-arguing direction, but not enough to build a product surface. The
Astro 7 validation fixture is green for the normal server build boundary. The componentization
attempt now resolves the local WIT world after vendoring the minimal official WASI v0.2.3 graph.
The current blocker is generated Astro bundle evaluation under ComponentizeJS: the bounded
componentization command fails on `node:module`, and static inspection shows the generated Astro
bundle still carries `process`, `Buffer`, and `sharp`:

- `docs/superpowers/plans/2026-06-25-astro-wasi-ssr-poc.md`.
- `validations/astro-wasi-ssr/`.

Decision:

- Part C is red for now; no Astro-on-Tractor adapter spec is opened.
- ADR-070 Parts A/B remain the accepted direction.
- Do not block item 4, Marimo WASM distribution, or generator/codemod work on item 5.

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
| 8a `vault-seed` `silo.js` -> `@refarm.dev/silo` | **Refarm handoff ready after 4c**: `apps/refarm` providers and `vault-seed` both need the same namespaced collect boundary; local tarball proof stayed adapter-only | namespaces preserve model/runtime/channel/publishing separation |
| 8b channel policy (`contacts` + `rate-limiter` + receipts) | **Refarm-side package slice active**: `@refarm.dev/channel-policy-v1` covers destinations, rate-limit policy/evidence, delivery state, receipts, dry-run, and review semantics | official `vault-seed` Telegram adapter proof must emit the neutral envelope while keeping API/UX downstream |
| 8c `launch-process` + artifact provenance | **Refarm-side proof active**: `@refarm.dev/launch-process` process specs validate as `artifact-contract-v1` provenance; `@refarm.dev/cli/launch-process` remains a compatibility re-export | official `dgk-runner`/`dgk-cli` proof must import the SDK internally, preserve `dgk` UX, and emit manifests without leaking `dgk` command names upstream |

Spec rule: each bridge gets its own feature spec and its own consumer proof. A bridge does not
start because it is convenient; it starts because the second consumer exists. `vault-seed` counts
as that consumer only for the specific primitive it already duplicates.

For 8b, the first package boundary is conservative: one `channel-policy-v1` evidence contract is
preferable to prematurely splitting `contacts` and `rate-limiter`. Split only when conformance
tests show the subdomains need independent versioning.

8a focused activation packet:

- `specs/features/2026-06-26-vault-seed-silo-bridge.md`;
- `docs/superpowers/plans/2026-06-26-vault-seed-silo-bridge.md`.

8b focused activation packet:

- `specs/features/2026-06-26-channel-policy-bridge.md`;
- `docs/superpowers/plans/2026-06-26-channel-policy-bridge.md`;
- `.refarm/handoff/vault-seed/2026-06-26/refarm.dev-channel-policy-v1-0.1.0.tgz`
  (`sha256 9daaa089560b558a145b0af78dc09a8b66cfd13decce362d205f7362d97f4ddf`).

8c focused activation packet:

- `specs/features/2026-06-26-launch-process-provenance-bridge.md`;
- `docs/superpowers/plans/2026-06-26-launch-process-provenance-bridge.md`.

## Additional Downstream Assimilation Backlog

These are not new top-level roadmap items; they are pressure signals to attach
to the existing lanes before `vault-seed` grows more local substrate:

| Pressure | Attach to | Next planning move |
|---|---|---|
| Lab dataset/outbox/notebook manifests | `artifact-contract-v1`, WASM substrate | Official `vault-seed` proof emits `refarm.task-artifacts.v1` manifests from Lab/outbox/notebook producers. |
| Generated-vault smoke/reset/template inventory | vault generator + codemod registry | Keep active; this is the boilerplate-killing lane. |
| Release package smoke, lockfile template sync, version contracts | `release-engine`, package acceptance summary/checklist | Plan a release-policy consumer proof after generator inventory exists. |
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
- retired before codemod promotion: `CredentialProvider` import re-homing landed as a smaller
  manual 4c change; generated-vault manifest/inventory wiring landed as item 9a generator-first
  work;
- ready codemods: `ds-token-adoption` for consumer CSS token/theme adoption and
  `package-workspace-adoption` for generated or external consumer manifests;
- remaining candidates: ADR-069 publish-target scope sweep stays manual-reviewed unless it recurs;
  repository/package metadata rewrites broader than initial generated-vault materialization should
  become codemods only when a second generated vault or consumer checkout needs the same rule;
- not codemods: ADR decisions, one-off prose, and speculative research notes.

`ds-token-adoption` is a ready codemod entry. It has before/after
fixtures, preserves nested CSS at-rules, is idempotent, and exposes a JSON
dry-run report. A cache-only proof against
`/home/vscode/.cache/checkouts/github.com/aretw0/vault-seed/.site/styles/marimo-vault.css`
reported `changed: true`, `importsAdded: 3`, and
`semanticDeclarationsRemoved: 205` with `written: false`; official downstream
application/visual review remains on the `vault-seed` side.

`package-workspace-adoption` is now the second ready codemod entry. It parses
package manifests as JSON, can set a concrete generated package `name`, and
rewrites only explicitly mapped `workspace:` dependency ranges. A cache-only
proof against
`/home/vscode/.cache/checkouts/github.com/aretw0/vault-seed/package.template.json`
with `--external @aretw0/dgk-astro-plugins=latest` reported `changed: true`,
`nameChanged: false`, `workspaceDependenciesRewritten: 1`, and
`written: false`; official downstream application remains on the `vault-seed`
side.

Vault-seed generator classification:

- generator actions: payload copy, template-dev file exclusion, deterministic rename, generated
  `inventory.json`, welcome-note status publication, current `vault.config.json` kudos
  removal/license-holder fill, `package.template.json` repository URL materialization from
  the target repository, and generated-vault externalization of the excluded
  `@aretw0/dgk-astro-plugins` workspace dependency. These are local, idempotent, and covered by
  the generated-vault smoke boundary.
- codemod candidates: repository/package metadata rewrites beyond the initial template
  materialization, plus any future cross-file JSON/TS/CSS rewrite needed by more than one generated
  vault or consumer checkout. Package-name adoption and targeted workspace dependency
  externalization are already covered by `package-workspace-adoption`.
- still not codemods: Markdown prose choices and ADR/spec content. Promote them only after a
  repeatable structural rule exists.

## Item 9a - Vault-Seed Generator

The generator-first direction is implemented as a prototype:

- `specs/features/2026-06-25-vault-seed-generator-contract.md`;
- `docs/superpowers/plans/2026-06-25-vault-seed-generator-contract.md`.
- `generators/vault-seed/manifest.json`;
- `generators/vault-seed/generate.mjs`.

The proof is manifest + inventory driven and passes the selected generated-vault smoke gate against
the cached `vault-seed` checkout when available. The Refarm-side release consumer proof also
generates a vault fixture, reads `inventory.json`, and verifies generated `@refarm.dev/*`
dependencies are covered by the `vault-seed-ready` release policy. Official downstream adoption
remains outside this checkout.

## Item 9b - Codemod Registry

The codemod-first direction has a registry contract and two ready entries before any new platform
work:

- `specs/features/2026-06-25-codemod-registry-contract.md`;
- `docs/superpowers/plans/2026-06-25-codemod-registry-contract.md`.
- `codemods/registry.json`;
- `codemods/ds-token-adoption.mjs`;
- `codemods/package-workspace-adoption.mjs`.

Continue with metadata, fixtures, dry-run command, and rollback note. Do not create a hosted
registry or MCP integration without a separate product reason.

## Item 10 - Linux Async I/O (`io_uring`)

`io_uring` is worth tracking because Refarm has native Rust hot paths and agent workloads that can
be file/socket heavy. It is not a cross-platform default and must not leak into TS public APIs.

Spec and plan:

- `specs/features/2026-06-25-io-uring-substrate.md`;
- `docs/superpowers/plans/2026-06-25-io-uring-substrate.md`.

Started as `validations/io-uring-substrate/`:

- selected workload: generated/source materialization with deterministic fixture tree copy and
  byte-for-byte output hash;
- `pnpm run io-uring:probe:test` compiles a tiny `rustc`-only syscall probe into `/tmp` and
  classifies support without Cargo/crates;
- current devcontainer evidence:
  `validations/io-uring-substrate/evidence/probe-current.json` reports `status: "blocked"`,
  `errno: 1`, kernel `5.15.153.1-microsoft-standard-WSL2`, and fallback `standard-file-io`.

The first gate is not raw throughput; it is capability probe + fallback + a meaningful win on a
Refarm-shaped workload. In this container, do not spend cycles on `tokio-uring` implementation
until another host/container reports `available`.

## Item 11 - XR/WebXR Surface

XR is a frontier surface, not a core dependency:

- `specs/features/2026-06-25-xr-surface-poc.md`;
- `docs/superpowers/plans/2026-06-25-xr-surface-poc.md`.

The first gate is equal data across 2D fallback and XR scene. A-Frame or three.js stays isolated to
the POC until graduation evidence exists.

Started as `validations/xr-surface-poc/`:

- selected data envelope: renderer-neutral Refarm surface map (`ds`, `homestead-ssr`,
  `dispatch-surface`, `release-engine`);
- `pnpm run xr-surface:poc:test` verifies fixture shape, WebXR capability classification, and equal
  node/action IDs across deterministic 2D fallback and XR scene markup;
- no production package imports A-Frame or three.js.

The next useful step is a contained static preview under the validation directory. Do not introduce
an XR package or production dependency before browser/device evidence exists.
