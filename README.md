# Refarm

Personal operating system for sovereign data.

Refarm is an experimental local-first system for owning, connecting and moving personal data. The current repository is primarily for building the engine, developer tooling and first applications. Public end-user use is not released yet.

Website: <https://refarm.dev>

## Current Status

Refarm is pre-release. The priority is making the creator's own daily-driver flow reliable before publishing a general user experience.

- Current focus: sync, execution and plugin runtime stabilization.
- Main app surface: `apps/dev`.
- Engine/runtime work: `packages/tractor`, `packages/tractor-ts`, `packages/pi-agent`, storage and sync packages.
- Package release automation exists, but publish is explicitly gated.

## For Future Users

The intended user outcome is a portable personal data graph that can run offline first and sync through open or replaceable infrastructure.

Current user-facing principles:

- data should remain portable;
- browser/local storage should work without a central server as the default assumption;
- plugins should extend the system without locking users to one registry;
- identity, discovery and sync should be replaceable over time.

This repository is not yet a polished product download. Until release gates are met, the docs and commands here are mainly for contributors and operators.

## For Developers

```bash
pnpm install
pnpm run dev
pnpm run build
pnpm test
```

Common entry points:

| Area | Start here |
|---|---|
| Architecture | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Development workflow | [docs/WORKFLOW.md](docs/WORKFLOW.md) |
| Package registry | [packages/README.md](packages/README.md) |
| Roadmap | [roadmaps/MAIN.md](roadmaps/MAIN.md) |
| Contribution guide | [CONTRIBUTING.md](CONTRIBUTING.md) |

Changes to published packages should include a changeset when applicable:

```bash
pnpm run changeset
```

## For Release And Deploy Operators

Release and deploy surfaces are intentionally separate:

- GitHub Pages deploy builds `apps/dev` through `.github/workflows/deploy-dev.yml`.
- Package publishing uses Changesets through `.github/workflows/release-changesets.yml`.
- Runtime descriptor release assets are validated by `runtime-descriptor:release-smoke`.
- Publish automation requires repository variables/secrets and is not enabled by ordinary local commands.

Useful dry-run and contract checks:

```bash
pnpm run actions:pins
pnpm run deploy:publish:workflow:test
pnpm run release:check
pnpm run runtime-descriptor:release-smoke
```

## Security And Governance

- Security policy: [SECURITY.md](SECURITY.md)
- PR quality policy: [docs/PR_QUALITY_GOVERNANCE.md](docs/PR_QUALITY_GOVERNANCE.md)
- Agent collaboration rules: [AGENTS.md](AGENTS.md)
- License: [AGPL-3.0](LICENSE)
