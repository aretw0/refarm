# @refarm.dev/scarecrow-plugin

The **Scarecrow** — a sandboxed host-effect observer, as a WASM plugin. It is the thesis
in one sentence: **the policy that governs extensions is itself a sandboxed extension.**

## What it does

It declares `provides: ["observe-host-effects"]` in its manifest. The tractor host, on
seeing that capability, registers the plugin as a host-effect observer and forwards every
`host-effect:*` event (fs read/write/edit, shell spawn) to it via the standard
`integration.on-event` — no new WIT interface (per ADR-067). For each effect the plugin:

- classifies its **risk** (fs:read=low, fs:write/edit=medium, shell:spawn=high; unknown =
  high, fail-closed) using the same vocabulary the platform's permission model uses;
- records a **verdict** (`flagged` for high-risk, `noted` otherwise);
- stores a `ScarecrowObservation` node the host can read back — a governance trail produced
  by the plugin, not the host.

## The sandbox is the point

The crate targets the base `plugin` world — its only host import is `tractor-bridge`
(store-node, emit-telemetry). It imports **no** `host-fs`, `host-shell`, or `host-net`.
So the governor **cannot do the very things it governs**: it can watch a plugin read a
file, but it cannot read one itself. The governor is the least-privileged citizen.

## Build

```sh
pnpm --filter @refarm.dev/scarecrow-plugin run build:wasm   # → dist/plugin.wasm + plugin.json
pnpm --filter @refarm.dev/scarecrow-plugin run test         # native (pure verdict helpers)
```

The T1 example's `governance-audit --observer` verb boots this plugin beside the agent and
reports what it witnessed — governance happening in-sandbox, not simulated in TS.
