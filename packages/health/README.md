# @refarm.dev/health

Health provides diagnostic utilities for workspace projects and runtime instances.
Refarm consumes it through a Refarm-specific policy preset, but the base auditors
are workspace-agnostic.

## Features

- **Project Diagnostics**: Automated checks for workspace structure, build config, and package entrypoints.
- **Build Verification**: Ensuring required source/build contracts are present and valid.
- **Configurable Project Policy**: `ProjectAuditor` is generic by default; `RefarmProjectAuditor` is only a convenience preset with Refarm roots and exemptions.
- **Opt-in Complexity Pressure**: `ComplexityAuditor` reports large hand-written files when a workspace enables `health.complexity`.
- **Actionable Output**: `refarm health --json` includes stable `recommendations` for agents and CI wrappers.

## CLI Policy

`refarm health` uses the Refarm preset only when the current workspace is the
Refarm monorepo. Other workspaces default to the generic workspace auditor.
Inspect the resolved policy before tuning an external repo:

```bash
refarm health --policy --json
```

Ask for a reviewed, non-writing suggestion from the current diagnostics:

```bash
refarm health --suggest-policy --json
```

Apply that suggestion only after review:

```bash
refarm health --apply-suggested-policy --json
```

Projects can calibrate the generic auditor by declaring a `health` section in
`refarm.config.json`:

```json
{
  "health": {
    "workspaceRoots": ["packages", "apps"],
    "exemptPackageIds": ["packages/meta"],
    "ignoredGitVisibilityPatterns": ["**/*.generated.ts"],
    "complexity": {
      "enabled": true,
      "maxLines": 1000,
      "paths": ["packages", "apps"],
      "allowedPatterns": ["packages/generated/**"],
      "reportLimit": 10
    },
    "title": "Workspace Health"
  }
}
```

Set `"preset": "refarm"` only for projects that intentionally want the Refarm
monorepo exemptions.

See [ROADMAP.md](./ROADMAP.md) for the path to the `refarm health` command.
