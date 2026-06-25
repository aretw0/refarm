# Plan: Linux Async I/O Substrate (`io_uring`) POC (Roadmap Item 10)

> Spec: `specs/features/2026-06-25-io-uring-substrate.md`.
> Goal: determine whether `io_uring` deserves a native Refarm substrate behind Tractor/Farmhand
> capability probes.

## Task 1 - Workload Selection

- Pick one Refarm-shaped file workload: source materialization, generated-vault output, or artifact
  log fanout.
- Define fixture size, file count, concurrency, and correctness hash.
- Gate: workload is reproducible and can run without network.

## Task 2 - Capability Probe

- Add a small Rust probe that detects whether `io_uring` can initialize in the current kernel and
  container.
- Record kernel version, container profile symptoms, and fallback reason.
- Gate: probe reports `available`, `blocked`, or `unsupported` without crashing.

## Task 3 - Baseline Implementation

- Implement the selected workload with the current normal Rust I/O path.
- Measure wall time, CPU roughness, and p95 operation latency if applicable.
- Gate: correctness hash matches expected output.

## Task 4 - `io_uring` Implementation

- Implement the same workload behind a private Rust module.
- Start with `tokio-uring` if it fits the fixture, but record whether its runtime/threading model
  is acceptable for Refarm. If it is invasive, repeat the spike with the lower-level `io-uring`
  crate or `liburing` bindings.
- Keep TS APIs unchanged.
- Gate: correctness hash matches baseline.

## Task 5 - Benchmark and Observability Report

- Compare baseline vs `io_uring` with the same fixture.
- Record what tracing/logging can observe and what becomes harder to see.
- Gate: produce a short evidence file under the validation directory.

## Task 6 - Decision Update

- If ROI is strong and operational risk is acceptable, write an ADR for `async-io:native-linux`.
- If ROI is weak or environment friction is high, mark item 10 deferred and keep the evidence.

## Non-Goal

Do not replace Node/TS I/O or public command APIs. This is a native substrate experiment only.
