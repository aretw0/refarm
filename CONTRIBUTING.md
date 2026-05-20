# Contributing to Refarm

Thank you for your interest in contributing to Refarm! This guide will help you understand our workflow and get started.

---

## Overview

Refarm is a monorepo consisting of:

- **Distros** (`apps/`): `refarm.me` (sovereign citizen hub), `refarm.dev` (Studio/IDE), `farmhand` (headless daemon)
- **Blocks** (`packages/`): Philosophy-neutral primitives assembled by distros — tractor-ts, homestead, storage-sqlite, sync-loro, identity-nostr, etc.
- **Examples**: Reference implementations

We follow a structured **SDD → BDD → TDD → DDD** workflow with quality gates between phases. See [docs/WORKFLOW.md](docs/WORKFLOW.md) for the complete process.

---

## Development Workflow

### 1. Installation

```bash
pnpm install
pnpm run dev      # Start all apps in watch mode
```

### 2. Making Changes

- Create a feature branch from `develop`
- Use branch naming pattern: `task/<TASK-ID>-<slug>` (e.g. `task/T-PLAN-05-branch-policy`)
- Keep 1 primary task per branch/PR for traceability
- Test your changes locally

### Quality Gates (Local + CI)

Refarm enforces quality with a two-mode pre-push hook and CI checks:

- **Feature branches**: permissive mode (warns, can continue)
- **`main` and `develop`**: strict mode (blocks push on `lint` and `type-check` failures)
- **`test:unit` and security audit**: advisory locally, enforced in CI

Install/update hooks locally:

```bash
pnpm run hooks:install
```

Useful references: `docs/PR_QUALITY_GOVERNANCE.md`, `docs/BRANCH_PROTECTION_SETUP.md`

### Smoke + Full gates

```bash
pnpm run gate:smoke:foundation
pnpm run gate:smoke:contracts
pnpm run gate:smoke:runtime
pnpm run gate:full:colony
```

Rule: atomic PR → smoke the affected domain. Batch consolidation → full gate required.

### 3. Version Management with Changesets

```bash
pnpm run changeset
```

This prompts you to select changed packages, choose a version bump type, and summarize changes. Include the resulting `.changeset/` file in your PR.

### 4. Pull Request

- Reference any related issue (`closes #123`)
- Ensure all tests pass: `pnpm run test`

### 5. Versioning & Release (Maintainers Only)

```bash
pnpm run build
pnpm run changeset:version   # Bump versions + update CHANGELOGs
pnpm run changeset:publish   # Publish to npm
```

---

## Development Guidelines

### Code Quality

- **TypeScript**: strict mode (`tsconfig.json`)
- **Linting**: `pnpm run lint` before committing
- **Build**: `pnpm run build` should succeed

### Commit Messages

Conventional Commits format. One intent per commit (fix/refactor/test/docs).

- ✅ `feat(storage): add CRDT vector clock implementation`
- ❌ `Fix stuff`, `WIP`

### Diagrams

Diagrams are Mermaid source files (`.mermaid`) with auto-generated SVG renderings. Global styling lives in `specs/diagrams/mermaid.config.json`.

When you edit a `.mermaid` file:

```bash
pnpm run diagrams:fix   # regenerates SVG with global design system applied
git add docs/**/*.mermaid docs/**/*.svg
git commit -m "docs: update diagram"
```

CI verifies SVG files match their source on PRs.

If `pnpm run diagrams:fix` fails due to missing Chromium shared libraries, update `.devcontainer/Dockerfile` — not a one-off apt install.

### AI Engineering

AI agents contributing to this repo must follow the rules in [AGENTS.md](AGENTS.md): never edit build artifacts, run builds after dependency changes, and commit session knowledge to docs. See also [docs/PROCESS_PLAYBOOK.md](docs/PROCESS_PLAYBOOK.md) for daily operational commands.

---

## Accessibility & i18n

See [docs/A11Y_I18N_GUIDE.md](docs/A11Y_I18N_GUIDE.md) for:

- WCAG 2.2 Level AA standards and patterns
- i18n setup and translation workflow
- Testing procedures (`pnpm run test:a11y`, `pnpm run i18n:check`)

---

## Testing

```bash
pnpm run test      # Run all tests
pnpm run build     # Verify build
pnpm run lint      # Type check & linting
```

---

## Questions?

- **Issues**: Check [existing issues](https://github.com/aretw0/refarm/issues)
- **Discussions**: Start a [discussion thread](https://github.com/aretw0/refarm/discussions)
- **Security**: See [SECURITY.md](SECURITY.md) for reporting vulnerabilities

---

## License

Refarm uses a **multi-tier licensing model** — the license that applies to your contribution depends on which package you're touching:

| Package type | License | Examples |
|---|---|---|
| Core apps & kernel | AGPL-3.0 | `apps/dev`, `packages/tractor`, `packages/sower` |
| Contracts, SDKs, WIT interfaces | MIT / Apache 2.0 | `*-contract-v1`, `packages/plugin-manifest`, `templates/*` |
| Brand assets & docs | CC-BY-SA 4.0 | SVGs, design files |

This intentional split keeps the core copyleft (preventing cloud enclosure) while allowing third-party plugins to be MIT, commercial, or closed-source without license contamination.

See [docs/LICENSING_POLICY.md](docs/LICENSING_POLICY.md) for the full rationale and the decision rule for new packages.
