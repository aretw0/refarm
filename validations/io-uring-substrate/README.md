# io_uring Substrate Validation

Status: Task 1 and Task 2 evidence for roadmap item 10.

This validation keeps `io_uring` behind a native capability probe. It does not add a public TS API,
does not require a Cargo crate, and does not make Linux async I/O a default Refarm dependency.

## Selected Workload

The first Refarm-shaped workload is generated/source materialization:

- deterministic fixture tree copy;
- many small files plus a few larger files;
- byte-for-byte output hash;
- no network;
- bounded file count so it can run inside the devcontainer without stressing memory.

This workload maps to generated vault output and source materialization without importing
`vault-seed` product semantics.

Task 3 will add the baseline implementation for this workload. Task 2 is intentionally smaller:
prove the runtime can classify native `io_uring` support as `available`, `blocked`, or
`unsupported` without crashing.

## Probe

Run:

```bash
node validations/io-uring-substrate/run-probe.mjs --json
```

To refresh the checked-in local evidence:

```bash
node validations/io-uring-substrate/run-probe.mjs --json --out validations/io-uring-substrate/evidence/probe-current.json
```

The runner compiles `probe.rs` with `rustc` directly into `/tmp`, then executes it. The Rust probe
calls `io_uring_setup` with a minimal ring and immediately closes the fd when available. It uses no
external crates and no Cargo workspace build.

Expected statuses:

- `available`: the kernel and container profile allowed `io_uring_setup`;
- `blocked`: the syscall exists but the container/seccomp/profile blocked it;
- `unsupported`: the syscall is missing, not supported by the current kernel/runtime, or the probe
  cannot compile in this environment.

## Gate

```bash
node --test validations/io-uring-substrate/probe.test.mjs
```

The test only asserts probe shape and bounded status classification. It deliberately avoids a
performance benchmark until the baseline materialization fixture exists.
