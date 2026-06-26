# Release Engine Public Contracts

This package treats the following surfaces as public contracts once published:

- Package exports in `package.json`.
- `ReleasePolicy`, `ReleasePlan`, `ReleaseGateResult`, and exported helper types
  in `types/index.d.ts`.
- `release-policy.schema.json`.
- `release-output.schema.json`.
- CLI JSON payloads emitted by `plan`, `check`, and `gates`.
- `ReleasePolicyValidationError.code` values.
- `SUPPORTED_POLICY_VERSIONS` and `RELEASE_ENGINE_JSON_SCHEMA_VERSION`.

## Append-only rule

After the first public release, critical contracts are append-only within a major
version:

- Add optional policy fields instead of changing required fields in place.
- Add new JSON output fields instead of renaming or removing existing fields.
- Add new error codes instead of reusing a code for a different meaning.
- Add new schema definitions instead of narrowing existing definitions.
- Add new policy/schema versions when semantics change incompatibly.

Removing fields, renaming codes, changing requiredness, narrowing enums, or
changing the meaning of an existing version requires a major release.

Before first publication, incompatible corrections are allowed only when they are
captured in `CHANGELOG.md` under the active pre-publication version.
