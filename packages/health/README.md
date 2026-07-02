# @refarm.dev/health

Health provides diagnostic utilities for workspace projects and runtime instances.
Refarm consumes it through a Refarm-specific policy preset, but the base auditors
are workspace-agnostic.

Keep this package as the ecosystem primitive. Repository-local wrappers may add
their own allowances for generated state, fixtures, lockfiles, or vendored
artifacts, but those exceptions should not be baked into the generic auditors.

## Features

- **Project Diagnostics**: Automated checks for workspace structure, build config, and package entrypoints.
- **Build Verification**: Ensuring required source/build contracts are present and valid.
- **Configurable Project Policy**: `ProjectAuditor` is generic by default; `RefarmProjectAuditor` is only a convenience preset with Refarm roots and exemptions.
- **Opt-in Complexity Pressure**: `ComplexityAuditor` reports large hand-written files when a workspace enables `health.complexity`.
- **Environment Pressure**: `buildEnvironmentPressureReport` samples disk, memory, and maintenance markers without scanning or deleting workspace state.
- **Environment Work Ceilings**: `planEnvironmentWorkCeiling` maps a pressure report plus a caller-owned work class to `allow`, `degrade`, `serialize`, or `refuse`.
- **Session Pressure**: callers may pass known session files so resume paths can warn or block before loading oversized context.
- **Actionable Output**: `refarm health --json` includes stable `recommendations` for agents and CI wrappers.

## Programmatic Environment Pressure

Use the SDK primitive when a CLI, agent, or downstream tool needs a cheap
go/no-go signal before expensive work:

```js
import { buildEnvironmentPressureReport } from "@refarm.dev/health/environment-pressure";

const report = buildEnvironmentPressureReport({
  guidance: {
    diskPressureCommand: "pnpm run clean:rust:check",
  },
  sessionFiles: [
    { path: ".sessions/latest.jsonl", bytes: 180 * 1024 * 1024 },
  ],
  sessionResumeIntent: true,
});
```

The report decision is `continue`, `safe-mode`, or `stop-and-investigate`.
Consumers provide their own commands and wording; the primitive owns only the
measurement and classification policy. Session files are never discovered,
opened, archived, deleted, or compacted by this primitive; a caller must provide
the bounded file list it already decided is relevant.

When a caller already knows the class of work it wants to run, ask for a ceiling
decision before dispatch:

```js
import {
  buildEnvironmentPressureReport,
  planEnvironmentWorkCeiling,
} from "@refarm.dev/health/environment-pressure";

const report = buildEnvironmentPressureReport();
const ceiling = planEnvironmentWorkCeiling(report, {
  workClass: "broad-check",
  command: "pnpm exec turbo run test",
  fallbackCommand: "pnpm --filter @refarm.dev/health run test",
});
```

`safe-mode` still allows focused and package checks, degrades broad checks to a
caller-provided fallback, and serializes fan-out. `stop-and-investigate` refuses
new work and forwards the pressure report's recovery actions. The health package
does not execute either command; it only returns the handoff decision.

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
`.refarm/config.json`:

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

External projects should prefer the generic workspace policy and declare their
own generated-file or complexity allowances in their own `.refarm/config.json`.

The root-level `refarm.config.json` name is a legacy compatibility path for
existing projects. New workspaces should use `.refarm/config.json` so Refarm
state and policy stay grouped under one project-local directory.

Programmatic callers should pass an explicit workspace root when auditing a
repo other than the current process directory. The CLI uses the current
workspace by default, but the lower-level health core accepts `rootDir` so
agents do not need to mutate process-global `cwd` while inspecting external
projects.

See [ROADMAP.md](./ROADMAP.md) for the path to the `refarm health` command.
