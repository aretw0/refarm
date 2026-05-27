# CLI Package Roadmap

**Current Version**: v0.1.0-dev
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)

`@refarm.dev/cli` is the shared CLI primitive package. The executable Refarm
application lives in `apps/refarm`.

## Current Scope

- Refarm status schema contracts and formatting.
- JSON output envelopes and command result parsing.
- Command handoff, command plan, and execution plan helpers.
- Surface action affordance helpers.
- Browser-open and launch process helpers.
- Launch readiness policy.
- Git command and GitHub Actions CLI adapters.
- Operator resume formatting.

## Direction

- Prefer agnostic primary names for reusable primitives.
- Keep Refarm-specific names only for public Refarm contracts or compatibility
  aliases.
- Keep process execution behind shared adapters so app commands do not import
  `node:child_process` directly.
- Keep package-manager commands structured and resolver-driven.

## Next Hardening

- Continue moving reusable command contracts down from `apps/refarm` when at
  least two surfaces need them.
- Add compatibility tests whenever a Refarm-specific alias remains around an
  agnostic primary helper.
- Keep README and package exports aligned as new subpath modules are added.
