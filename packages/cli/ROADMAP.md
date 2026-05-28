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

## Boundary Map

Keep these modules agnostic by default:

- `command-handoff`
- `command-line`
- `command-result`
- `command-plan`
- `execution-plan`
- `browser-open`
- `launch-process`
- `git-command`
- `github-actions`

Treat these modules as Refarm compatibility contracts until they can move to a
dedicated operator/refarm contract package:

- `status`
- `action-affordances`
- `launch-policy`
- `operator-resume`

New Refarm-specific product behavior should start in `apps/refarm` or a
dedicated Refarm contract package, not in this package's generic primitive
surface.

## Next Hardening

- Continue moving reusable command contracts down from `apps/refarm` when at
  least two surfaces need them.
- Extract Refarm-specific contracts from this package only when the destination
  package and compatibility exports are clear.
- Add compatibility tests whenever a Refarm-specific alias remains around an
  agnostic primary helper.
- Keep README and package exports aligned as new subpath modules are added.
