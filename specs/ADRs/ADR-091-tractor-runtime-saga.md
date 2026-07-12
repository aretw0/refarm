# ADR-091: Tractor Runtime (Saga Index)

**Status**: Accepted  
**Progress**: Index only — 047/048/059/060 remain the binding specs; this is their front door  
**Date**: 2026-07-12  
**Deciders**: Arthur Silva, Claude  
**Related**: [ADR-044](ADR-044-wasm-plugin-loading-browser-strategy.md), [ADR-047](ADR-047-tractor-native-rust-host.md), [ADR-048](ADR-048-tractor-graduation.md), [ADR-049](ADR-049-post-graduation-horizon.md), [ADR-059](ADR-059-tractor-rust-authoritative-runtime.md), [ADR-060](ADR-060-tractor-http-sidecar-protocol.md)

---

## Context

The tractor runtime — the WASM plugin host at the heart of refarm — was decided in a
classic "prototype → graduation → authority" saga across several ADRs, plus the
sidecar protocol. Heavily referenced by code, so this is an INDEX, not a merge.

## The arc (each step owned by its child ADR)

1. **[ADR-047] tractor-native — Native Rust Plugin Host** — creates a native Rust
   host alongside the TS one.
2. **[ADR-048] Graduation → canonical `tractor`** — promotes the native host to
   canonical (`tractor-native` → `tractor`), keeping TS as a reference. *(047 is
   superseded by 048; 048 is refined by 059.)*
3. **[ADR-059] Tractor Rust as Authoritative Runtime** — makes Rust the *authority*;
   tractor-ts becomes a conformance harness, not a production runtime. **This is the
   current binding runtime decision.**
4. **[ADR-060] Tractor HTTP Sidecar Protocol** — fixes the sidecar wire protocol
   (`POST /efforts`, `GET /efforts/:id`, `/plugins`, `/efforts/:id/cancel`, …) that
   surfaces the runtime to CLI/other processes.

Adjacent: **[ADR-044]** (load WASM in the browser without JCO at load time) and
**[ADR-049]** (the dual-runtime post-graduation roadmap).

## How to read it

Runtime = **044 (browser load) → 047 (native host) → 048 (graduate) → 059 (Rust is
authoritative) → 060 (sidecar protocol)**. If you only read one, read **059** for the
current authority model and **060** for the wire protocol. This index adds no new
decision; each child keeps its own `Related: ADR-091` back-pointer.
