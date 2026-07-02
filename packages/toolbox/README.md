# @refarm.dev/toolbox

The Refarm Toolbox is a collection of shared developer utilities, build tools, and scripts used across the monorepo to ensure consistency and automate recurring tasks.

## Features

- **`git-commit-auto`**: Refarm's atomic git commit automator.
- **Important-commit guardrail**: high-impact groups (security/CI/release/Rust-WIT surfaces) require explicit commit-message confirmation before execution.
- **Strict mode (`GIT_COMMIT_AUTO_STRICT=1` or `--strict-important`)**: blocks generic commit messages and forces specific phrasing for important/low-confidence groups.
- **`task:finish` atomic-first flow**: the finish workflow now offers atomic commit grouping before falling back to a single branch-based commit.
- **Shared Build Scripts**: Standardized bundling and transpilation logic.
- **WASM Component Tools**: Utilities for working with the WASM Component Model and JCO.
- **`safety`**: Generic, resource-conscious execution gate primitive with configurable step profiles.

## `refarm-task safety` profiles

- `micro-safe` is the configured default for frequent local usage (`env-safety` + `reso status`).
- `micro`: historical gate (`env-safety` + resolution + optional resume/next-action).
- `normal` / `full`: provided through `.refarm/config.json` (`automation.safety.profiles`) via
  `scripts/refarm-safety.mjs`.

### Usage

- `node packages/toolbox/src/cli.mjs safety micro`
- `node scripts/refarm-safety.mjs normal --strict`
- `node scripts/refarm-safety.mjs micro-safe`
- `node scripts/refarm-safety.mjs full --json`
- `node scripts/refarm-safety.mjs --max-duration-ms 45000`

Top-level aliases (repo root):

- `pnpm run refarm:safety`
- `pnpm run refarm:safety:micro-safe`
- `pnpm run refarm:safety:micro`
- `pnpm run refarm:safety:normal`
- `pnpm run refarm:safety:full`

Budget precedence: CLI `--max-duration-ms` overrides profile budgets, which override `automation.safety.maxDurationMs` in `.refarm/config.json`.

Refarm-specific profile binding is implemented in
`.refarm/config.json` and `scripts/refarm-safety.mjs`, so the toolbox primitive
itself stays agnostic and profiles can be extended by users.

Example:

```json
{
  "automation": {
        "safety": {
          "defaultProfile": "micro-safe",
          "maxDurationMs": 65000,
          "maxDurationMsByProfile": {
            "micro-safe": 65000,
            "micro": 120000
          },
      "profiles": {
        "micro": [
          {
            "id": "env-safety",
            "command": ["bash", "scripts/env-safety-check.sh", "--warn"]
          }
        ]
      }
    }
  }
}
```

See [ROADMAP.md](./ROADMAP.md) for the path to the "Sovereign Toolchain".
