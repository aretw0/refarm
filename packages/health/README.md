# @refarm.dev/health

Health provides diagnostic and self-healing utilities for the Refarm monorepo and its runtime instances. It ensures that the system is in a "Green" state before critical operations.

## Features

- **System Diagnostics**: Automated checks for monorepo integrity (TS, Lint, Build).
- **Self-Healing Contracts**: Standardized ways for plugins to report and fix their own errors.
- **Build Verification**: Ensuring all required artifacts are present and valid.

See [ROADMAP.md](./ROADMAP.md) for the path to the `refarm health` command.
