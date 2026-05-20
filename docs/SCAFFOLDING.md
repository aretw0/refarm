# Scaffolding Development Policy

This document defines the constraints and protocols for developing and testing
scaffolding in the Refarm monorepo.

## 0. Scaffold Lanes

Refarm has two different scaffold lanes. They serve different audiences and
must not be mixed.

| Lane | Audience | Entry point | Templates | Purpose |
|---|---|---|---|---|
| Internal package scaffold | Refarm maintainers | `pnpm turbo gen package` | `turbo/generators/templates/*` | Create conformant packages inside this monorepo. |
| Public project scaffold | Refarm users and community | `refarm init` / `SowerCore.scaffold` | `templates/*` | Create user-facing workspaces or plugins outside this monorepo. |

Internal package scaffolds are coupled to Turbo, workspace package invariants,
and `scripts/validate-packages.mjs`. Public project scaffolds must stay useful
outside the monorepo and should depend on stable Refarm packages or narrow
runtime contracts rather than internal implementation details.

## 1. The Island Isolation Policy

> **"Do not scaffold into the workspace you are editing."**

Developing public scaffolding commands involves high-risk filesystem operations.
To prevent accidental pollution or destruction of the Refarm monorepo source,
all `refarm init` and `SowerCore.scaffold` operations MUST be performed in
isolated "Islands".

- **Prohibition**: Never run `refarm init` or `SowerCore.scaffold` with a target directory that points to or is a child of the Refarm monorepo root (unless explicitly testing internal hydration protocols in a controlled way).
- **Mandatory Target**: Always use the `targetDir` option (or equivalent CLI argument) and point it to a temporary directory (e.g., in `/tmp` or a git-ignored `/scratch` folder).

## 2. Testing Protocol

All scaffolding logic MUST be accompanied by transition tests in `packages/sower/src/core.test.ts`.

- **Randomized sandboxes**: Use randomized temporary directories for each test case.
- **Verification points**:
  - **Hydration**: Verify that all critical files (e.g., `README.md`, `package.json`, `Cargo.toml`) are present in the target island.
  - **Configuration**: Verify that `refarm.config.json` is generated with the correct parameters.
  - **Identity**: Verify that the `.refarm/identity.json` metadata is correctly initialized.
- **Cleanup**: Tests must clean up their sandboxes after completion.

## 3. Public Template Iteration

When adding a new public project template:
1. Create the template structure in `templates/[template-name]`.
2. Update `SowerCore.scaffold` logic if specific subdirectory mapping is required (e.g., `templates/[template-name]/typescript`).
3. Add a new test case in `core.test.ts` to verify hydration of the new template.
4. Run `pnpm -C packages/sower run test` to verify.

The default public app template is `workspace`, hydrated from
`templates/workspace/typescript`.

Files under `docs/examples/*` are examples or research sketches, not scaffold
inputs. Do not make `refarm init` depend on them without first promoting the
example into `templates/*` and adding hydration tests.

## 4. Internal Package Template Iteration

When changing internal package scaffolds:

1. Edit `turbo/generators/config.ts` or files under `turbo/generators/templates/*`.
2. Keep the generated shape aligned with `scripts/validate-packages.mjs`.
3. Run `node scripts/validate-packages.mjs`.
4. Prefer adding or updating generator tests before broadening scaffold types.

---

> "Scaffold in isolated directories so the repository stays reproducible."
