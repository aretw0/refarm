# Plan: Codemod Registry Contract

> Spec: `specs/features/2026-06-25-codemod-registry-contract.md`.
> Goal: make codemod-style work schedulable without picking a heavy platform too early.

## Task 1 - Add registry schema

- Create a small JSON schema or TypeScript validator for codemod registry entries.
- Include `id`, `status`, `tool`, fixtures, dry-run command, gate, and rollback note.
- Gate: invalid entry fixture fails.

## Task 2 - Seed candidates

- Add entries for `npm-scope-doc-sweep`, `credential-provider-rehome`, `ds-token-adoption`, and
  `vault-seed-manifest-inventory`.
- Mark only entries with enough fixtures as `ready`.
- Gate: registry validates.

## Task 3 - Dry-run discipline

- Add a command that prints planned files and tool choice without editing.
- Gate: dry run is deterministic in CI and local devcontainer.

## Task 4 - First implementation

- Pick the cheapest ready entry.
- Implement with the smallest tool that preserves structure.
- Gate: fixture test, dry-run output, target verification command, and rollback note.

## Task 5 - Factory handoff

- Update `docs/CONVERGENCE_FACTORY_READINESS.md` and `docs/CONVERGENCE_EXECUTION_RUNBOOK.md`.
- Do not introduce a hosted codemod registry or MCP integration in this slice.
