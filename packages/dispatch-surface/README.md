# @refarm.dev/dispatch-surface

Shared primitives for dispatch/control-surface transport handling.

> Note: this package is the TS boundary used by `refarm` and `farmhand`.
> Its behavior is now backed by an optional Wasm/WIT contract from
> `packages/dispatch-surface-rs` when available, with transparent fallback to the
> native TypeScript implementation.

## What it provides

- Task transport parsing (`file`, `http`, `channel:<name>`) with validation.
- Channel transport helpers (`channel:*` resolution and route builders).
- Channel effort payload validation and normalization used by runtime HTTP surface handlers.
- Source/metadata normalization currently mirrors the Rust core contract.
- Canonical channel-capability primitives (`hasChannelControlCapability`,
  `assertChannelControlCapability`, `CHANNEL_CONTROL_SURFACE_OPERATION_UNSUPPORTED_ERROR`)
  for deterministic operation gating.
- Shared universal contract reference: `../../specs/features/dispatch-control-plane-contract.md`.

## Native Rust backend integration

The TypeScript surface will automatically use the Rust-exported Wasm backend when
it is present and can be loaded, unless disabled:

- Set `DISPATCH_SURFACE_USE_RUST=0` to disable native fallback.
- Set `DISPATCH_SURFACE_SKIP_RUST=1` to disable native fallback.

To validate parity, run:

- `pnpm --filter @refarm.dev/dispatch-surface test:parity`

This command compares native-backed and TS-only behavior on representative
inputs.

If you need to (re)build optional Rust/Javascript artifacts used by the
native path:

- `pnpm run dispatch-surface:build-rs`

For a full parity CI-style validation (build + lint/type-check + parity tests):

- `pnpm run dispatch-surface:ci`

If you need a release-like build that requires native artifacts to be present:

- `pnpm run dispatch-surface:build-rs:release`

## Public API

See `src/index.ts` / exported surface.

## External consumer contract

External consumers import the package root only. Do not deep-import `src/*`;
the package owns whether calls are served by the optional Rust/Wasm backend or
the TypeScript fallback.

Parse a channel transport:

```ts
import {
	parseTaskTransport,
	resolveChannelFromTransport,
} from "@refarm.dev/dispatch-surface";

const transport = parseTaskTransport("channel:matrix");
const channel = resolveChannelFromTransport(transport);

if (!channel) {
	throw new Error("Expected a channel transport");
}

console.log(channel);
```

Build channel control paths:

```ts
import {
	buildChannelEffortPath,
	buildChannelEffortsPath,
	resolveChannelControlSurfaceAdapter,
} from "@refarm.dev/dispatch-surface";

const baseUrl = "http://127.0.0.1:42001";
const channel = "matrix";
const effortId = "effort-1";
const adapter = resolveChannelControlSurfaceAdapter(channel).adapter;

const submitPath = buildChannelEffortsPath(baseUrl, channel);
const statusPath = buildChannelEffortPath(baseUrl, channel, effortId, "status");
const logsPath = adapter.buildLogsPath(baseUrl, channel, effortId);

console.log({ submitPath, statusPath, logsPath });
```

Assert capabilities before dispatch:

```ts
import {
	assertChannelControlCapability,
	resolveChannelControlSurfaceAdapter,
} from "@refarm.dev/dispatch-surface";

const { adapter } = resolveChannelControlSurfaceAdapter("matrix");

assertChannelControlCapability(adapter, "submit");
assertChannelControlCapability(adapter, "query");
```
