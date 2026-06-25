# Spec: Linux Async I/O Substrate (`io_uring`) (Roadmap Item 10)

**Status:** DRAFT — research + POC gate
**Authors:** Arthur Silva
**Date:** 2026-06-25
**Related:** `docs/CONVERGENCE_ROADMAP.md`, `docs/CONVERGENCE_FACTORY_READINESS.md`,
`specs/ADRs/ADR-070-wasm-surface-substrate.md`, `docs/ARCHITECTURE.md`

---

## Context & Motivation

Refarm has a TypeScript microkernel/app layer and a Rust substrate around Tractor, WASM, native
artifacts, and runtime boundaries. `io_uring` is a Linux-specific asynchronous I/O interface built
around shared submission/completion rings between userspace and the kernel. It is relevant because
Refarm's long-term workloads include:

- agent task logs and artifact streaming;
- source materialization and generated-vault copying;
- Farmhand/Tractor local HTTP and file-heavy loops;
- storage/cache workloads where many small syscalls dominate latency;
- future native agent runtime paths where Rust can own the hot I/O loop.

The idea is attractive, but it is not portable and it changes the security/observability surface.
So the correct move is a substrate POC, not an architectural dependency.

## Decisions

1. **Native Rust only at first.** `io_uring` belongs behind a Rust/native capability layer. The TS
   microkernel sees a capability such as `async-io:native-linux`, not `io_uring` directly.
2. **Capability-probed, never required.** If the kernel/container/seccomp profile does not allow
   `io_uring`, Refarm falls back to the existing file/socket paths.
3. **`tokio-uring` is the first runtime candidate, not a foregone dependency.** It is the closest
   fit if the POC wants Tokio compatibility, but it starts its own `tokio-uring` runtime and its
   resource types have different ownership/threading expectations. Compare it against a lower-level
   Rust wrapper or direct `io-uring` crate before committing the substrate.
4. **Start with batch file I/O, not networking.** The first POC should benchmark artifact/source
   materialization because correctness is easier to verify than socket ordering.
5. **No WASM promise.** This is a Linux native substrate. It complements ADR-070's native-first
   direction; it does not change browser/WASM surfaces.
6. **Observability and sandbox policy are part of the gate.** A green benchmark without a story for
   tracing, failure mode, and container restrictions is not enough.

## Candidate ROI Areas

| Area | Why it might pay | First measurement |
|---|---|---|
| Source materialization | many file reads/writes and metadata operations | wall time + syscall count for large repo copy/read |
| Generated vault output | repeated deterministic file copying/transforms | wall time + CPU for manifest generation |
| Agent artifacts/logs | many small append/read operations | p95 append/read latency under concurrent tasks |
| Farmhand local transport | high request/concurrency loops | only after file POC proves ROI |
| Storage/cache internals | possible queue/batch benefit | deferred until storage workload is isolated |

## POC Boundary

Create a validation under `validations/io-uring-substrate/` that compares:

- baseline Rust implementation using existing standard async/blocking I/O;
- `io_uring` implementation for the same workload;
- capability probe and fallback path.

The first workload should materialize a deterministic fixture tree and verify byte-for-byte output.

Runtime candidates to evaluate:

- `tokio-uring` for Tokio-adjacent integration and safe high-level APIs;
- the lower-level Rust `io-uring` crate or `liburing` bindings for a smaller private substrate if
  the runtime model is too invasive.

## Green Criteria

- POC runs in the Refarm devcontainer or records exactly why the container blocks it.
- Fallback path works when `io_uring` is unavailable.
- Benchmark shows a meaningful win on the selected workload or records "not worth it yet".
- Observability notes cover what normal logs/tracing can and cannot see.
- The POC does not leak `io_uring` concepts into TS command APIs.

## Red Criteria

- Requires privileged container or host-specific setup for normal development.
- Improves synthetic benchmark but not a Refarm-shaped workload.
- Adds hard-to-debug behavior without enough telemetry.
- Forces Linux-only behavior into public APIs.

## References

- `io_uring(7)` Linux manual: <https://man7.org/linux/man-pages/man7/io_uring.7.html>
- `tokio-uring` docs: <https://docs.rs/tokio-uring/latest/tokio_uring/>
- `liburing`: <https://github.com/axboe/liburing>
- `uringscope` observability paper: <https://arxiv.org/abs/2606.15137>
- DBMS `io_uring` evaluation: <https://arxiv.org/abs/2512.04859>
