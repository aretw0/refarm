# Spec: Dispatch Surface External API (Roadmap Item 4d)

**Status:** DRAFT — ready for implementation after 4a/4b baseline
**Authors:** Arthur Silva
**Date:** 2026-06-25
**Related:** `docs/CONVERGENCE_ROADMAP.md` item 4, `docs/APPS_REFARM_PROMOTION_LEDGER.md`,
`specs/features/dispatch-control-plane-contract.md`, `packages/dispatch-surface`

---

## Context & Motivation

`@refarm.dev/dispatch-surface` already exists and is consumed internally by Refarm/Farmhand. It
exports transport parsing, channel effort normalization, route builders, and channel control
capability adapters. The convergence audit says this is a mature block, but the external-consumer
boundary is not yet explicit.

This item does not extract new logic. It stabilizes the public API so `vault-seed`, `agents-lab`,
headless Refarm commands, or future operator shells can depend on the package without importing
accidental internals.

## Decisions

1. **Public surface is the current package root, curated.** `@refarm.dev/dispatch-surface` remains
   the only public subpath for now. No deep imports.
2. **Channel-control API is the external contract.** Stable exports are:
   `parseTaskTransport`, `resolveChannelFromTransport`, `isChannelEffortPayload`,
   `buildChannelEffort`, `buildChannelEffortsPath`, `buildChannelEffortPath`, `encodeChannel`,
   `decodeChannel`, `normalizeChannelSource`, `normalizeChannelContext`,
   `ChannelControlSurfaceAdapter`, `ChannelControlSurfaceCapabilities`,
   `ChannelControlSurfaceOperation`, `hasChannelControlCapability`,
   `assertChannelControlCapability`, `resolveChannelControlSurfaceAdapter`,
   `listKnownChannelControlSurfaces`, `isKnownChannelControlSurface`, and registry overrides.
3. **Rust-backed parity stays internal to the package.** Consumers do not choose TS vs Rust/WASM;
   the package keeps transparent fallback.
4. **Consumer proof must be headless.** First proof should not require a web shell. Use a
   headless Refarm command or validation fixture that imports only the package root and exercises
   channel control paths.
5. **No dispatch runtime in this item.** The item stabilizes helpers; it does not build
   `source-dispatch` or a skill runtime.

## Package Work

- Add a public API lock test that imports from `@refarm.dev/dispatch-surface` and asserts the
  exported keys.
- Add a no-deep-import test/documentation rule: consumers use package root only.
- Expand README with "External consumer contract" and examples for:
  - parsing `channel:<name>`;
  - building submit/status/log paths;
  - asserting operation capability before rendering/dispatching an action.
- Keep `test:parity` as the TS/Rust behavior guard.

## Consumer Proof

Add a validation or focused app test that:

1. imports only `@refarm.dev/dispatch-surface`;
2. resolves a known channel and an unknown channel;
3. builds submit/status/log paths;
4. disables one capability through registry override and verifies the expected unsupported error.

This proves an external-style consumer can wire action affordances without touching app internals.

## Verification

1. `pnpm --filter @refarm.dev/dispatch-surface run test`
2. `pnpm --filter @refarm.dev/dispatch-surface run test:parity`
3. `pnpm --filter @refarm.dev/dispatch-surface run type-check`
4. package acceptance entries remain present in `test-capabilities` / `gate-smoke-contracts` if a
   new focused gate is added.

## Out of Scope

- `source-dispatch` adapter (roadmap item 7).
- A skill runtime or skill adapter (roadmap item 6).
- New channel providers. Provider-specific behavior belongs in consumers or later bridges.
