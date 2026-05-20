# @refarm.dev/health

Health provides diagnostic utilities for workspace projects and runtime instances.
Refarm consumes it through a Refarm-specific policy preset, but the base auditors
are workspace-agnostic.

## Features

- **Project Diagnostics**: Automated checks for workspace structure, build config, and package entrypoints.
- **Build Verification**: Ensuring required source/build contracts are present and valid.
- **Configurable Project Policy**: `ProjectAuditor` is generic by default; `RefarmProjectAuditor` is only a convenience preset with Refarm roots and exemptions.
- **Actionable Output**: `refarm health --json` includes stable `recommendations` for agents and CI wrappers.

## CLI Policy

`refarm health` uses the Refarm preset when no local policy exists. Projects can
opt into the generic auditor by declaring a `health` section in
`refarm.config.json`:

```json
{
  "health": {
    "workspaceRoots": ["packages", "apps"],
    "exemptPackageIds": ["packages/meta"],
    "ignoredGitVisibilityPatterns": ["**/*.generated.ts"],
    "title": "Workspace Health"
  }
}
```

Set `"preset": "refarm"` only for projects that intentionally want the Refarm
monorepo exemptions.

See [ROADMAP.md](./ROADMAP.md) for the path to the `refarm health` command.
