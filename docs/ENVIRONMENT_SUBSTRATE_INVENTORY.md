# Environment Substrate Inventory

Status: working inventory for the current Refarm runtime substrate.

This document maps what currently makes Refarm runnable across the development
container, GitHub Actions, host installs, and future reproducible environment
lanes such as Nix. It is intentionally descriptive: the goal is to separate
project dependencies from machine substrate before adding another environment
path.

## Why This Exists

Refarm should become easy to install and operate without hiding too much magic.
Before adding a Nix dev shell or a curated NixOS profile, the project needs a
clear map of the runtime it already depends on.

The practical test for any future substrate is simple: it must reduce ambiguity
for operators and agents. If it merely duplicates devcontainer, CI, and host
setup logic, it is premature.

## Current Owners

| Surface | Owner today | Scope |
| --- | --- | --- |
| Devcontainer base image | `.devcontainer/Dockerfile` | Linux development substrate, system packages, Rust/WASM tools, Playwright OS libraries, GitHub CLI |
| Devcontainer lifecycle | `.devcontainer/post-create.sh`, `.devcontainer/post-start.sh` | Dependency install, shims, Git transport, permissions, hooks, runtime sanity |
| Devcontainer contract | `.devcontainer/devcontainer.json`, `scripts/ci/test-devcontainer-contract.mjs` | Ports, volumes, host requirements, cache mounts, environment variables |
| Node package graph | `package.json`, `pnpm-lock.yaml`, `scripts/package-manager.sh` | Workspace dependencies and package-manager selection |
| Host CLI install | `scripts/install-refarm-cli.mjs` | Local `refarm` shim, Windows `.cmd`, optional build, JSON handoff output |
| GitHub Actions setup | `.github/actions/setup`, `.github/workflows/test.yml` | CI dependency install, platform compatibility, Turbo/cache setup, Rust and browser setup |
| Rust substrate | `.cargo/config.toml`, Dockerfile Rust install, CI setup | Toolchain, targets, components, resource limits |
| Browser/E2E substrate | Dockerfile Playwright libraries, CI setup action | Chromium/Playwright runtime dependencies |
| Runtime health | `refarm check --next-action --json`, `refarm agent finish --run --json` | Operator and agent readiness gates |
| Substrate inventory check | `pnpm run environment-substrate:check --json` | Versioned JSON for required Node/Rust/WASM/Git substrate plus non-blocking diagnostic tools |

## Environment Substrate

These are machine/runtime concerns. They should be available before project
commands are expected to be reliable.

- Node 22 or newer.
- Corepack and pnpm, currently pinned through `packageManager`.
- Git, Git LFS, SSH/HTTPS Git transport, and GitHub CLI.
- Rust stable with `rust-src`, `clippy`, and `rustfmt`.
- Rust targets: `x86_64-unknown-linux-gnu`, `wasm32-unknown-unknown`, and
  `wasm32-wasip1`.
- WASM tooling: `wasm-tools` and `cargo-component`.
- Playwright/Chromium system libraries for Linux E2E runs.
- Common diagnostics: `bash`, `jq`, `ripgrep`, `fd`, `shellcheck`, `shfmt`,
  `tree`, `hyperfine`, and `direnv`. These should be reported separately from
  required cross-platform substrate so Windows/macOS are not blocked by
  Linux-container diagnostics.
- Bubblewrap capability for sandbox/runtime checks in the container.
- Locale and encoding defaults that do not break Portuguese content.
- Persistent caches for pnpm, npm globals, Turbo, Playwright, Cargo registry,
  Cargo git, Cargo target, and Refarm local state.

## Project Build Dependencies

These belong to the repository graph, not to the machine image:

- Workspace package dependencies managed by `pnpm-lock.yaml`.
- Turbo task graph and cache metadata.
- TypeScript, Vitest, ESLint, Playwright packages, and workspace CLIs.
- Generated package artifacts under package/application build outputs.
- Validation artifacts under `.artifacts/` when produced by local or CI runs.

Future environment work should not vendor these into a system profile. The
system profile should make the package graph easy to install, validate, cache,
and diagnose.

## Current Gaps

1. There is no single JSON inventory command that reports the expected substrate
   across host, container, and CI.
2. Devcontainer and GitHub Actions encode overlapping knowledge, but there is no
   shared machine-readable contract for all tools and versions.
3. Host install is intentionally lightweight, but it does not yet explain every
   missing substrate dependency in the same vocabulary as `refarm check`.
4. Windows compatibility is validated in CI, but the container remains the
   primary development substrate.
5. Nix has no implementation yet, so it cannot be used as a source of truth.

## Nix Readiness Boundary

A Nix dev shell becomes useful only when it can reproduce this inventory more
clearly than the current scripts. The first acceptable Nix lane should:

- coexist with devcontainer, Windows, and host-native installs;
- provide the machine substrate, not the workspace dependency graph;
- run the same readiness commands as other environments;
- explain drift in JSON so an agent can act on it;
- avoid becoming the only supported path.

## Near-Term Work

1. Promote the substrate check into the operator-facing CLI once the script
   contract is stable enough for host, container, Windows, and CI use.
2. Add browser runtime and devcontainer volume details to the same JSON
   envelope without making the check expensive.
3. Extract the devcontainer contract into a reusable data shape that can be
   compared by tests instead of only by shell scripts.
4. Teach host install/readiness flows to point at the same missing-substrate
   vocabulary.
5. Only then add an experimental Nix dev shell and judge it against this
   inventory.
