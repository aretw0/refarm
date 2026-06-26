# Changelog

## 0.1.0-dev

Pre-publication line for the first npm release. This package is still unpublished;
entries here are the intended `0.1.0` contract unless a later pre-publication
commit moves them under a newer version.

### Added
- Internal docs and roadmap alignment for v0.x pre-publishing stability.
- Default policy lookup now prefers embedded `.refarm/config.json` (`releasePolicy`) with safe fallback to `release-policy.json` and neutral defaults.
- `@refarm.dev/release-engine` exposes the release policy SDK used by `refarm release`; the package-local CLI remains only a smoke surface.
- Policy selections can drive release candidates through `releasePolicy.defaultSelection`/`selections`, and missing explicit selections fail closed.
- Release policy validation now rejects ambiguous provider contracts, including publish-capable providers without `publishCommands`.
- Provider validation exposes `ReleasePolicyValidationError.code` for machine consumers and accepts neutral/inactive provider contracts without generating publish intents.
- Policy version compatibility now fails closed through `SUPPORTED_POLICY_VERSIONS` and `RELEASE_POLICY_VERSION_UNSUPPORTED`.
- Blocked `plan`/`check` CLI JSON now preserves the versioned machine-output shape.
- `CONTRACTS.md` defines append-only public contract surfaces and ships in the package.

### Semver discipline

Until the first public release, breaking corrections are allowed only before the
package is packed/published. After publication, public exports, JSON schemas,
policy versions, and CLI JSON fields follow semver:

- `patch`: bug fixes and additive output/schema fields.
- `minor`: new exported helpers, new optional policy fields, new provider types,
  and additive JSON schema definitions.
- `major`: removal, required-field changes, renamed codes, or incompatible
  `schemaVersion`/`policyVersion` changes.

## 0.0.1-dev

### Added
- Initial deterministic release planning core:
  - `buildReleasePlan`, `runReleaseGates`, `loadPolicy`, `validatePolicy`.
  - Topological package ordering and blocker reporting.
- Policy-driven gates with required/optional phase classification.
- Package test suite with fixture workspaces and embedded-policy coverage.
- `packages/release-engine` package scaffolding, schema, README and package-local smoke CLI.
