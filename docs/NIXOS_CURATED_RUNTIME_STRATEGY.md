# NixOS Curated Runtime Strategy

Status: strategic note for evaluating Nix/NixOS as a future Refarm substrate.
This is not an implementation commitment.

## Question

Could Refarm become a curator of itself through NixOS: reproducible enough to
ship as a serious daily-driver environment, while also improving the Nix
experience it depends on?

Short answer: yes, but only if it starts as a substrate lane, not as a distro
promise.

## External Signals

- Omarchy shows the value of an opinionated personal computing experience: a
  curated Linux environment can be easier to adopt when taste, defaults, and
  workflow are part of the product surface.
- Clan shows the value of treating machines as a managed network: one source of
  truth, peer-to-peer operation, secret provisioning, service setup, backups,
  mesh networking, and live deployment over existing Linux hosts.

Reference links:

- Omarchy: https://omarchy.org/
- Clan: https://clan.lol/

The useful lesson is not "copy either project." The useful lesson is that
reproducibility and taste are both product features. Refarm should make its
runtime reproducible, but also understandable enough that the operator can
inspect, override, and migrate it.

## Strategic Fit

NixOS fits Refarm's long-term goals in four places:

1. **Daily-driver substrate**
   - Reproducible workstation, CLI, agent runtime, model routes, service
     dependencies, browsers, Rust/WASM tooling, and Node substrate.
   - Current devcontainer remains the pragmatic baseline while Nix proves value.

2. **Agent-operable environment**
   - A Refarm agent should be able to inspect a declarative environment, propose
     a patch, validate it, and roll it back.
   - This aligns with existing JSON handoffs and task-artifact evidence.

3. **Fleet and homelab bridge**
   - Clan-like concepts become relevant when Refarm manages more than one
     machine: laptop, workstation, home server, cloud runner, or private node.
   - Refarm should integrate with machine management rather than invent a second
     fleet system too early.

4. **Consumer proof**
   - A curated Nix lane can become a high-trust POC: install, reproduce, run the
     validations, and inspect the evidence.
   - This strengthens Refarm as a serious daily driver before selling it to
     others.

## What Refarm Should Not Do Yet

- Do not declare a Refarm OS distribution before the CLI is a dependable daily
  driver.
- Do not replace devcontainers, Windows validation, or host-native install
  paths with Nix-only assumptions.
- Do not fork or rebrand Nix/Clan concepts before proving a small integration.
- Do not hide too much magic in a flake; the operator must see what changed and
  why.

## Phased Approach

### Phase 0: Inventory

- Document current runtime dependencies from devcontainer, GitHub Actions, and
  install scripts.
- Identify which dependencies are environment substrate versus project build
  dependencies.
- Produce a `refarm environment doctor --json` style target before making Nix
  authoritative.

### Phase 1: Nix Dev Shell

- Add an experimental `flake.nix` for a dev shell only.
- It should provision Node, pnpm/corepack, Rust, cargo-component, wasm tooling,
  Playwright dependencies where practical, GitHub CLI, and common diagnostics.
- It must coexist with devcontainer and host install paths.

### Phase 2: Reproducible Validation Profile

- Add a focused Nix profile that can run:
  - `pnpm run validation-pocs:test`
  - `pnpm run cli:install:verify`
  - `refarm check --next-action --json`
- Treat this as the first proof that Refarm can curate its own substrate.

### Phase 3: Curated Workstation Layer

- Only after Phase 1 and 2 are stable, explore a curated workstation profile.
- This is where Omarchy-like taste becomes relevant: terminal, editor, browser,
  secrets UX, model providers, local services, and agent surfaces.
- The output should feel intentional, but still remain inspectable and
  overrideable.

### Phase 4: Clan / Fleet Bridge

- Evaluate whether Refarm should consume Clan, contribute to Clan, or simply
  emit compatible machine/service declarations.
- The first integration should be read/plan/validate before deploy.
- Any secret or machine management must preserve Refarm's operator consent and
  audit trail.

## Decision Boundary

Nix becomes a strategic substrate if it improves all of these:

- faster fresh-machine bootstrap;
- clearer environment drift diagnostics;
- reproducible validation lanes;
- safer agent-operated environment changes;
- lower support burden for Windows, Linux, devcontainer, and CI differences.

If it only creates a second build system to maintain, it is premature.

## Near-Term Refarm Work

The next useful work is not to write a full flake. It is to add an environment
substrate inventory and map each dependency to the current owner:

- devcontainer image;
- post-create/post-start scripts;
- GitHub Actions setup;
- host install script;
- package manager lockfile;
- Rust/WASM toolchain;
- browser/E2E runtime dependencies.

Once that inventory exists, a Nix dev shell can be judged by whether it removes
ambiguity instead of adding another path.
