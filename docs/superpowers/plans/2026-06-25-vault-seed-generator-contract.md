# Plan: Generator-First Vault-Seed Distribution (Roadmap Item 9a)

> Spec: `specs/features/2026-06-25-vault-seed-generator-contract.md`.
> Goal: prototype a manifest-first `refarm gen vault-seed` path that can generate a smoke-tested
> vault without turning the template into hand-copied boilerplate.

## Task 1 - Inventory Manifest Draft

- Read `vault-seed` file layout and `initialize.yml`.
- Draft the manifest schema and classify a small initial file set.
- Gate: manifest distinguishes payload from template-dev-only files.

## Task 2 - Generator Skeleton

- Add a Refarm generator entry point that accepts `--source` and `--out`.
- Copy only manifest-listed payload files.
- Emit an inventory report.
- Gate: generated directory contains expected files and excludes dev-only files.

## Task 3 - Transform Hooks

- Implement transform hook plumbing with no more than two initial transforms:
  repository identity and package metadata.
- Make transforms idempotent.
- Gate: running generation twice produces the same output.

## Task 4 - Smoke Harness

- Run the selected `vault-seed` generated-vault smoke command against the generated output.
- Capture command and evidence in the inventory report.
- Gate: smoke passes or the missing prerequisite is recorded.

## Task 5 - Codemod Decision

- Identify which transforms should become codemods (`ast-grep`, `ts-morph`, or a local structured
  parser) and which should remain direct generator actions.
- Do not codemod Markdown prose unless the transform is mechanical and repeated.

## Non-Goal

Do not migrate existing user vaults. That is a separate migration contract after generation works.
