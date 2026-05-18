# @refarm.dev/health

Health provides diagnostic and self-healing utilities for workspace projects and runtime instances. Refarm consumes it through a Refarm-specific policy preset, but the base auditors are workspace-agnostic.

## Features

- **System Diagnostics**: Automated checks for monorepo integrity (TS, Lint, Build).
- **Self-Healing Contracts**: Standardized ways for plugins to report and fix their own errors.
- **Build Verification**: Ensuring all required artifacts are present and valid.
- **Configurable Project Policy**: `ProjectAuditor` is generic by default; `RefarmProjectAuditor` is only a convenience preset with Refarm roots and exemptions.

See [ROADMAP.md](./ROADMAP.md) for the path to the `refarm health` command.
