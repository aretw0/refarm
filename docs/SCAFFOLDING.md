# Scaffolding Development Policy

This document defines the constraints and protocols for developing and testing scaffolding templates in the Refarm monorepo.

## 1. The Island Isolation Policy

> **"Never cultivate where you live."**

Developing scaffolding commands involves high-risk filesystem operations. To prevent accidental pollution or destruction of the Refarm monorepo source, all scaffolding operations MUST be performed in isolated "Islands".

- **Prohibition**: Never run `refarm init` or `SowerCore.scaffold` with a target directory that points to or is a child of the Refarm monorepo root (unless explicitly testing internal hydration protocols in a controlled way).
- **Mandatory Target**: Always use the `targetDir` option (or equivalent CLI argument) and point it to a temporary directory (e.g., in `/tmp` or a git-ignored `/scratch` folder).

## 2. Testing Protocol

All scaffolding logic MUST be accompanied by transition tests in `packages/sower/src/core.test.ts`.

- **Randomized sandboxes**: Use randomized temporary directories for each test case.
- **Verification points**:
  - **Hydration**: Verify that all critical files (e.g., `README.md`, `package.json`, `Cargo.toml`) are present in the target island.
  - **Configuration**: Verify that `refarm.config.json` is generated with the correct parameters.
  - **Identity**: Verify that the `.refarm/identity.json` (Silo brain) is correctly initialized.
- **Cleanup**: Tests must clean up their sandboxes after completion.

## 3. Template Iteration

When adding a new template:
1. Create the template structure in `templates/[template-name]`.
2. Update `SowerCore.scaffold` logic if specific subdirectory mapping is required (e.g., `templates/[template-name]/typescript`).
3. Add a new test case in `core.test.ts` to verify hydration of the new template.
4. Run `npx vitest packages/sower` to verify.

---

> "We seed the future on islands of safety, so the home soil remains pure."
