# Changelog

## Unreleased

- Internal docs and roadmap alignment for v0.x pre-publishing stability.
- Default policy lookup now prefers embedded `.refarm/config.json` (`releasePolicy`) with safe fallback to `release-policy.json` and neutral defaults.
- `release-engine` CLI supports required plan preflight and dry-run gates with JSON outputs suitable for host/controller orchestration.

## 0.0.x-dev

### Added
- Initial deterministic release planning core:
  - `buildReleasePlan`, `runReleaseGates`, `loadPolicy`, `validatePolicy`.
  - Topological package ordering and blocker reporting.
- Policy-driven gates with required/optional phase classification.
- Package test suite with fixture workspaces and embedded-policy coverage.
- `packages/release-engine` package scaffolding, schema, README and wrapper scripts.

## Planned 0.1.0

- Release-engine package publication as `@refarm.dev/release-engine`.
- Provider integration groundwork and control-plane composition refinements.
