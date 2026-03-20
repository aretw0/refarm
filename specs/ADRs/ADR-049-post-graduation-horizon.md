# ADR-049: Post-Graduation Horizon — Dual-Runtime Capabilities

**Status**: Proposed
**Date**: 2026-03-20
**Authors**: Refarm Team
**Supersedes**: N/A
**Related**: ADR-047 (Tractor Native Rust Host), ADR-048 (Tractor Graduation)

---

## Context

With the graduation of `tractor-native` to `tractor` (ADR-048, 2026-03-19), Refarm now has two mature, interoperable runtimes:

| Runtime | Package | Target |
|---------|---------|--------|
| TypeScript | `packages/tractor-ts` (`@refarm.dev/tractor`) | Browser, Node.js, Deno |
| Rust native | `packages/tractor` (`tractor` binary) | Native/bare-metal, IoT, CLI, Tauri |

Both runtimes share:
- Identical WIT contracts (`wit/refarm-sdk.wit`)
- Identical SQLite schema (`PHYSICAL_SCHEMA_V1`)
- Binary-compatible Loro CRDT format (`loro-crdt` JS@1.10.7 ↔ `loro` Rust)
- Same WebSocket protocol (port 42000, binary Loro frames)

Before ADR-048, the Rust runtime was R&D. After ADR-048, it is production-ready. This opens deployment scenarios that were **architecturally impossible** with the TypeScript-only runtime.

---

## Decision

Record the new capability surface unlocked by the dual-runtime existence. This ADR does not mandate implementation — it articulates the space of possibilities so future contributors and ADRs have a clear starting point.

---

## New Capabilities Unlocked

### 1. Edge and IoT Deployment

**Before**: Deploying Refarm required Node.js (>100 MB) or a browser.
**After**: The `tractor` binary (~27 MB, zero dependencies) runs on:
- Raspberry Pi Zero/2/3/4 (ARM)
- Android via Termux
- Alpine Linux containers
- Bare-metal embedded systems with enough RAM for wasmtime

**What this enables**:
- Persistent sovereign graph on always-on home servers
- Refarm as a local smart-home agent
- Air-gapped deployments (no cloud dependency whatsoever)

### 2. CLI Agents Without Node.js

**Before**: The `apps/farmhand` CLI agent required the full Node.js runtime.
**After**: CLI agents can be built with `use tractor::TractorNative` — a single Rust binary with no external runtime.

**What this enables**:
- `refarm` CLI commands that work without `npm install`
- Shell scripts and cron jobs that interface with the sovereign graph natively
- Distribution as a single binary (no npm publish required for CLI tools)

### 3. Offline-First With Native Persistence

**Before**: Offline-first required OPFS (browser-only API) or IndexedDB.
**After**: The Rust daemon provides SQLite persistence anywhere `rusqlite` runs.

**What this enables**:
- Sync between browser (OPFS) and native daemon (SQLite) via Loro binary protocol
- Native daemon as the "always-on" peer that holds state when the browser is closed
- Schema-compatible `.db` files shareable between browser and native contexts

### 4. Native WASM Without JCO Transpilation

**Before**: Node.js required JCO to transpile WASM Component Model binaries to JS.
**After**: `wasmtime` loads standard WASM Component Model binaries directly.

**What this enables**:
- Plugins compiled once, run on both runtimes without JCO step
- Faster plugin load time on server/daemon (no transpilation at runtime)
- Simpler plugin distribution (one `.wasm` binary, no `.jco-dist/` artifacts)

---

## Consequences

### Positive
- Deployment flexibility: one codebase, two runtimes, many environments
- Plugin ecosystem: `.wasm` plugins are truly universal
- Reduced operational complexity for server/daemon deployments

### Negative / Risks
- **Two runtimes = two maintenance surfaces**: bugs in the protocol must be fixed in both
- **Schema drift risk**: if `PHYSICAL_SCHEMA_V1` evolves, both implementations must be updated atomically
- **Consumer testing gap**: 7 consumers have been tested with `tractor-ts`; end-to-end validation with native daemon is pending (tracked in `roadmaps/MAIN.md`)

### Neutral
- The `tractor-ts` package (`@refarm.dev/tractor`) remains the primary recommendation for browser and Node.js consumers — Rust is additive, not a replacement
- `farmhand` (the old Node.js daemon) is superseded by the `tractor` binary for server/daemon use cases

---

## Future Work This Unlocks

This ADR is foundational for:

| Future ADR / Feature | Prerequisite |
|----------------------|-------------|
| IoT/RPi deployment guide | ADR-049 (this) |
| CLI `refarm` binary (no npm) | ADR-049 + v0.1.0 contracts |
| Native daemon as "always-on peer" | ADR-049 + Homestead sync (v0.1.0 Gate 3) |
| AI inference as WASI syscall (VISION_2026) | ADR-049 + TEM plugin + v0.1.0 contracts |

---

## References

- [ADR-047: Tractor Native Rust Host](ADR-047-tractor-native-rust-host.md)
- [ADR-048: Tractor Graduation](ADR-048-tractor-graduation.md)
- [packages/tractor/docs/ARCHITECTURE.md](../../packages/tractor/docs/ARCHITECTURE.md) — Consumer map
- [docs/proposals/VISION_2026_AI_AGENT_SOVEREIGNTY.md](../../docs/proposals/VISION_2026_AI_AGENT_SOVEREIGNTY.md)
