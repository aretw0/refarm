# Release Kernel Inventory

This is a working inventory for deciding what can become a first public
`@refarm.dev/*` release surface. It does not authorize publication by itself.
Publication remains gated by [`v0.1.0-release-gate.md`](v0.1.0-release-gate.md)
and the repository `releasePolicy`.

## Classification Rules

Use these buckets when deciding where effort should converge:

| Bucket | Meaning | Release posture |
| --- | --- | --- |
| Kernel contract | Stable interface package whose breaking changes should become a new `*-v2` package. | Candidate for earliest publication after conformance and docs are current. |
| Kernel primitive | Reusable implementation-agnostic helper used by more than one app/project. | Publish after contract tests, README, and consumer-neutral naming are clear. |
| Reference implementation | Concrete implementation of a contract. | Hold until daily-driver or second-consumer evidence exists. |
| Daily-driver app/control plane | Product behavior for `apps/refarm` or personal operator flow. | Ship as app behavior first; extract only when repeated. |
| Lab/internal | Experimental, environment-specific, or private operations. | Do not publish as public API. Feed lessons back into contracts/primitives. |

## Current Kernel Candidates

These packages are the strongest first-release candidates because they define
contracts or product-neutral helpers:

| Package | Bucket | Current posture | Notes |
| --- | --- | --- | --- |
| `@refarm.dev/storage-contract-v1` | Kernel contract | Candidate | Existing release gate marks it validated; keep as immutable contract. |
| `@refarm.dev/sync-contract-v1` | Kernel contract | Candidate | Existing release gate marks it validated; keep as immutable contract. |
| `@refarm.dev/identity-contract-v1` | Kernel contract | Candidate | Existing release gate marks it validated; keep as immutable contract. |
| `@refarm.dev/artifact-contract-v1` | Kernel contract | Candidate after review | Aligns with lab/vault artifacts; needs explicit release gate entry before publication. |
| `@refarm.dev/automation-contract-v1` | Kernel contract | Candidate after review | Useful for agent/workflow convergence; verify external vocabulary is not Refarm-app-specific. |
| `@refarm.dev/effort-contract-v1` | Kernel contract | Candidate after review | Useful for task/agent handoffs; publish only with examples and conformance clear. |
| `@refarm.dev/session-contract-v1` | Kernel contract | Candidate after integration | Existing gate defers pending pi-agent namespace and storage adapter convergence. |
| `@refarm.dev/task-contract-v1` | Kernel contract | Candidate after integration | Existing gate defers pending pi-agent/farmhand/storage-sqlite integration. |
| `@refarm.dev/stream-contract-v1` | Kernel contract | Candidate after review | Good boundary for transports; verify consumer examples. |
| `@refarm.dev/context-provider-v1` | Kernel contract | Candidate after review | Useful for agents-lab style context injection if kept provider-neutral. |
| `@refarm.dev/cli` | Kernel primitive | Hold for boundary review | Now owns reusable command, JSON, execution, workspace sweep, and handoff primitives; publish only if README and subpath exports are treated as API. |
| `@refarm.dev/config` | Kernel primitive | Hold for boundary review | Workspace/release/model config APIs are reusable; needs typed docs and policy on config shape stability. |
| `@refarm.dev/release-engine` | Kernel primitive | Candidate after dogfood | Already generic by design; should first drive Refarm's own release inventory and one external workspace policy. |

## Reference Implementations To Hold

These may be valuable, but publishing them now would freeze too much behavior
before daily-driver evidence:

| Package | Reason to hold |
| --- | --- |
| `@refarm.dev/storage-memory`, `@refarm.dev/storage-rest`, `@refarm.dev/storage-sqlite` | Implementations need conformance matrix and real consumer usage. |
| `@refarm.dev/sync-crdt`, `@refarm.dev/sync-loro` | Needs offline/reconnect and corruption recovery evidence. |
| `@refarm.dev/tractor`, `@refarm.dev/tractor-rs` | Reference runtime should wait for daily-driver gate and clear Rust/npm/crates split. |
| `@refarm.dev/barn`, `@refarm.dev/plugin-manifest`, `@refarm.dev/plugin-courier`, `@refarm.dev/plugin-tem` | Plugin surface still needs multi-layer evidence; avoid WASM-only lock-in. |
| `@refarm.dev/homestead`, `@refarm.dev/ds` | Product/UI substrate should mature through `apps/me` and `apps/refarm` first. |
| `@refarm.dev/silo`, `@refarm.dev/trust`, `@refarm.dev/scarecrow`, `@refarm.dev/registry` | Security/trust APIs need threat-model and operational evidence before public API promises. |

## Daily-Driver And Lab Surfaces

Keep these out of the release kernel unless repetition proves a primitive:

| Surface | Current home |
| --- | --- |
| `refarm workspace execution --all` product envelope | `apps/refarm`; reusable sweep stays in `@refarm.dev/cli/workspace-sweep`. |
| External checkout bridges (`agents-lab`, `vault-seed`) | `.refarm/config.json` declarations; no automatic mount/write behavior. |
| Cloudflare Turbo cache provisioning command | `apps/refarm` product command; cache detection primitive stays provider-neutral. |
| Prize-writing, vault publishing, benchmark notebooks | Consumer/lab projects; feed only contracts and preflight primitives back into Refarm. |

## Policy Alignment

`.refarm/config.json` `releasePolicy.packageProfiles` has been aligned with the
first kernel-contract and kernel-primitive candidates in this inventory. The
policy uses schema-compatible `risk` values plus tags to distinguish:

- `kernel-contract`: immutable `*-v1` interfaces with conformance gates.
- `kernel-primitive`: reusable helpers with README/subpath-export API review.
- `reference-implementation`: implementations gated by daily-driver or second-consumer evidence.
- `internal-lab`: no publish intent.

This keeps `release-engine` generic while making Refarm's own release decisions
explicit, inspectable, and reusable by `vault-seed` and `agents-lab`.

`refarm release plan --selection default --json` includes `packageProfiles` for
selected packages, so a control plane can inspect these posture tags without
making the engine Refarm-specific.
