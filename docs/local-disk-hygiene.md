# Local disk hygiene

Refarm can generate large local artifacts, especially Rust `target/` trees from
`packages/tractor`, WASM component builds, and validation fixtures. This repo is
optimized for a constrained workstation workflow: keep builds fresh by rebuilding
only the package under active work, then clean low-value artifacts at session
boundaries.

## Daily routine

Before starting work, measure rather than guess:

```bash
npm run disk:check
```

At the end of a normal session:

```bash
npm run clean:light
```

This removes Rust incremental caches and all `.turbo` directories while keeping
most build outputs that make the next package-scoped check faster.

## Cleanup tiers

| Tier   | Command                | Use when                                      | What it removes                                    |
| ------ | ---------------------- | --------------------------------------------- | -------------------------------------------------- |
| Report | `npm run disk:check`   | Before deciding what to build/clean           | Nothing                                            |
| Light  | `npm run clean:light`  | End of session                                | Rust incremental/stale objects + `.turbo`          |
| Medium | `npm run clean:medium` | After test/coverage runs or noisy experiments | Light + `coverage/` + `.artifacts/` + `artifacts/` |
| Heavy  | `npm run clean:heavy`  | Host is critically low on disk                | Entire Rust `target/` dirs + medium cleanup        |

Avoid deleting `node_modules` unless absolutely necessary. Reinstalling packages
also needs temporary disk and network, so it is a last resort.

## Build discipline while disk is tight

Prefer package-scoped checks:

```bash
npm --prefix packages/tractor-ts run type-check
npm --prefix packages/storage-memory run test:unit
```

For Rust, stay package- and target-specific:

```bash
cd packages/tractor
cargo check
cargo test --lib some_module
```

Avoid these during low-disk local work unless preparing a push/release:

```bash
npm run build
turbo build
cargo test
```

## Docker Desktop / WSL note

Deleting artifacts inside the devcontainer may not immediately reduce free space
reported by the host OS. On Windows-backed Docker Desktop/WSL2, shut down WSL and
compact/prune Docker's virtual disk when host space remains low after cleanup.
