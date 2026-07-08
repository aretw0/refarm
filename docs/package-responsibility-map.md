# Package Responsibility Map

This map exists because package names like `sower`, `barn`, or `windmill` are memorable but not self-explanatory. The first question for any package is not "what is the theme?" but "which boundary does it own?"

## Responsibility Rule

A package deserves to stay separate when it owns at least one hard boundary:

- a versioned contract or conformance suite;
- a provider/adapter implementation behind a contract;
- a runtime, trust, or security boundary;
- a reusable host/composition primitive;
- a public scaffold/template lane;
- a release, health, policy, or developer-factory tool;
- a dependency profile with different volatility from its consumers.

If two packages share the same boundary, dependency profile, release cadence, and consumers, merging should be considered. The themed name is not enough reason to keep a package separate.

## Map

| Responsibility | Packages | Role |
|---|---|---|
| Versioned contracts | `*-contract-v1`, `node-contract-v1`, `policy-contract-v1`, `channel-policy-v1` | Define stable data/capability envelopes and conformance. They should not own app vocabulary. |
| Capability host/composition | `capabilities-v1`, `capability-host`, `operator-state`, `dispatch-surface`, `process-handoff`, `local-surface` | Let apps/examples compose surfaces and operator handoffs from neutral blocks. |
| Source/records/content blocks | `source-contract-v1`, `source-git`, `source-local`, `source-web`, `source-provider-ref`, `records-contract-v1`, `content-projection`, `enrichment-contract-v1` | Turn external/local material into neutral source/record/content capabilities. |
| Storage/sync/identity providers | `storage-*`, `sync-*`, `identity-*`, `heartwood`, `credentials-contract-v1` | Concrete providers behind contracts; usable outside the Refarm app. |
| Runtime/plugin kernel | `tractor`, `tractor-ts`, `runtime`, `sidecar-client`, `plugin-manifest`, `plugin-surface-loader`, `registry`, `barn`, `scarecrow`, `agent`, `host-effects` | Load, validate, trust, expose, and run plugins/components. |
| UI/surface blocks | `ds`, `ds-astro`, `homestead`, `terminal-plugin`, `prompt-contract-v1` | Shared visual/interactive surfaces and prompt primitives. Apps should consume these rather than owning reusable UI logic. |
| Stream/transport blocks | `stream-contract-v1`, `file-stream-transport`, `sse-stream-transport`, `ws-stream-transport` | Transport adapters and stream contracts for sidecars/control planes. |
| Infra/release/factory tools | `sower`, `thresher`, `fence`, `health`, `windmill`, `release-engine`, `toolbox`, `config`, `deps`, `tsconfig`, `vtconfig`, `eslint-config` | Developer/operator factory: scaffold, validate, reconcile, release, configure, and check the workspace. |
| Reference plugins/components | `plugin-courier`, `plugin-tem`, `quality-checker-plugin`, `quality-checker-ref`, `vault-surface-ref` | Proof consumers for plugin, WASM, quality, and vault surfaces. They should pressure contracts without becoming mandatory app dependencies. |
| App-facing libraries | `cli`, `root`, `trust`, `model-mock` | Shared application support. These should stay thin and promote reusable behavior into narrower packages when it becomes general. |

## Where `sower` Fits

`sower` is not "just runtime" and not an example helper. It owns the public workspace scaffold/import lane:

- `turbo gen *` creates internal monorepo workspaces: packages, apps, examples, validations.
- `SowerCore.scaffold` / `refarm init` creates public user-facing workspaces/plugins from `templates/*`.

That is why T1/T2/T3 did not naturally exercise `sower`: those examples are internal DGK workbenches that should pressure `capability-host`, `capabilities-v1`, and multi-surface extension. `sower` gets exercised when the product question is "can a user create a new outside workspace/plugin safely?"

The current bridge is the scaffold inventory:

```bash
pnpm run scaffold:inventory
```

It keeps the internal Turbo factory and the public Sower factory visible in one report. The next Sower-specific hardening is not to import examples, but to make public templates conform to the same artifact hygiene and eventually the same inventory/conformance discipline.

## Merge/Split Heuristics

Prefer merging when:

- two packages only differ by theme/name;
- both are private helpers with the same consumers;
- one package is just re-exporting another without narrowing the boundary;
- tests always need both packages to mean anything.

Prefer splitting when:

- a consumer can use one without pulling a host app;
- a package can publish a stable contract while implementations iterate;
- a package protects a security/trust/runtime boundary;
- a package has a different release cadence or dependency cost;
- examples/apps are copying the same setup in multiple places.

## Current Factory State

The scaffold factory now has no `needs-generator` entries:

- `turbo gen package`
- `turbo gen example`
- `turbo gen app`
- `turbo gen validation`

Remaining non-generator decisions:

- `examples/matrix-bridge`: review whether it becomes a covered archetype or leaves the active example set.
- `templates/*`: reconcile the public Sower lane with scaffold conformance instead of treating it as an unrelated template copier.
