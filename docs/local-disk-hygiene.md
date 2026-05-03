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
cargo check --quiet
cargo test --lib some_module --quiet
```

Avoid these during low-disk local work unless preparing a push/release:

```bash
npm run build
turbo build
cargo test
```

## Validation economy

Use the smallest command that can falsify the change you just made. Bigger gates
are still valuable, but they should be checkpoints, not reflexes after every
edit.

| Situation                                  | Preferred local signal                                                                           | Avoid until checkpoint                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Pure Rust parser/helper edit               | `cargo test --lib <test_or_module> --quiet`                                                      | full `cargo test`                             |
| Rust API shape changed                     | focused test + `cargo check --quiet` in that package                                             | rebuilding unrelated crates                   |
| pi-agent source changed, no harness needed | `cargo check --target wasm32-wasip1 --quiet`                                                     | `cargo component build --release`             |
| pi-agent/Tractor boundary changed          | filtered `pi_agent_harness` run, sequential                                                      | full harness suite repeatedly                 |
| TS package edit                            | `npm --prefix <pkg> run type-check` or direct unit suite                                         | repo-wide `turbo build`                       |
| Before push                                | reproduce likely failures locally with the closest scoped command, then CI as final confirmation | using GitHub Actions as the first test runner |

For the current pi-agent streaming lane, prefer the wrapper scripts:

```bash
# Cheap package-level streaming checks, no WASM rebuild.
npm run agent:streaming:check

# Harness only when pi_agent.wasm is already fresh.
npm run agent:streaming:harness

# Explicit heavy gate: rebuild WASM, then run streaming harness filters.
npm run agent:streaming:harness:build
```

Do not run `npm run clean:light` after every small Rust slice. It saves disk but
also removes incremental caches; use it at session/checkpoint boundaries or when
`npm run disk:check` shows pressure.

## CARGO_TARGET_DIR volume redirect (devcontainer)

The devcontainer sets `CARGO_TARGET_DIR=/home/vscode/.cargo-target` and mounts that
path as the named Docker volume `refarm-cargo-target`. All cargo builds — including
`cargo component build` for pi-agent and `cargo build --release` for tractor — write
to that volume instead of each package's own `target/` subdirectory.

Consequences:

- **Binary paths**: `tractor` binary lives at `$CARGO_TARGET_DIR/release/tractor`;
  `pi_agent.wasm` at `$CARGO_TARGET_DIR/wasm32-wasip1/release/pi_agent.wasm`.
  Scripts read `CARGO_TARGET_DIR` and fall back to the workspace paths when the var
  is unset (local dev without the devcontainer).
- **Host disk**: workspace `target/` dirs are stale once the redirect is active. Run
  `npm run clean:heavy` once to remove them and reclaim host C:\ space (~2–3 GB).
- **Volume disk**: `npm run disk:check` now reports the volume size separately.
  `npm run clean:rust:full` also purges the volume when `CARGO_TARGET_DIR` is set.
- **Speed**: Docker volume I/O is faster than bind-mount WSL2 I/O, so incremental
  rebuilds are noticeably quicker.

## Docker Desktop / WSL note

Deleting workspace artifacts inside the devcontainer (bind mount on C:\) reclaims
space on the host immediately. Volume artifacts (`CARGO_TARGET_DIR`) live inside
Docker's virtual disk — they do not appear on C:\ but still consume the VHD.
When the VHD is bloated, shut down WSL and compact it:
`wsl --shutdown` then prune unused Docker volumes with `docker volume prune`.
