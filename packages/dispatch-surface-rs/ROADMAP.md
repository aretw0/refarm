# Dispatch Surface (Rust Core) Roadmap

**Current Version**: v0.1.0-dev
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)

## Strategic Direction

This crate is the **native canonical substrate** for transport/control-surface primitives. TypeScript packages should depend on this API for behaviorally stable parsing/normalization and keep only runtime glue in JS.

### Scope

- `dispatch_transport` parse/validation rules
- `channel:*` transport contract and normalization
- Channel effort payload validation
- Canonical builders for effort payload + endpoint paths
- Optional compile target matrix (native + Wasm)

## Current Status

- ✅ Core transport parser + payload validator implemented.
- ✅ Canonical normalization helpers implemented.
- ✅ Unit tests added.
- ✅ Component/WIT surface added (guest exports are generated from `wit/dispatch-surface.wit`).
- ✅ Native→Wasm export packaging is available (`scripts/build-dispatch-surface-rs.mjs`).
- ✅ TypeScript package bound to this crate with transparent runtime fallback and optional disable flags.
- ✅ Cross-runtime parity harness and CI lane added (`dispatch-surface:ci` and root workflow guard).

## Current Phase

- **Distribution policy finalized (runtime target):**
  - `dist/` + `pkg/` are strictly build artifacts and are never treated as source truth.
  - `pkg/dispatch_surface.js` is an opportunistic runtime enhancement; missing artifacts auto-fall back to TS behavior.
  - CI runs parity checks through `dispatch-surface:build-rs` only when dispatch-surface transport surfaces change.
- **Node/browser packaging path hardened:**
  - Contract semantics are now shared through `packages/dispatch-surface` and can be consumed from any host/runtime that can load the optional native module.

### Completed in this phase

- Documented and stabilized the universal control-plane contract for host/channel consumers:
  - `packages/dispatch-surface` + `dispatch-surface-rs` parity surface.
  - `docs/superpowers/specs/2026-06-17-dispatch-control-plane-contract.md`.
- Added explicit distribution policy for generated artifacts in `README.md`.


## Long-Term

- Evaluate moving additional transport/domain contracts from TS into Rust-first packages where feasible.
- Expand error typing into machine-readable error enums (not only strings).
- Add property-based tests for channel encoder/decoder path helpers.
