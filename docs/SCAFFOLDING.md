# Scaffolding Development Policy

This document defines the constraints and protocols for developing and testing
scaffolding in the Refarm monorepo.

## 0. Scaffold Lanes

Refarm has two different scaffold lanes. They serve different audiences and
must not be mixed.

| Lane | Audience | Entry point | Templates | Purpose |
|---|---|---|---|---|
| Internal package scaffold | Refarm maintainers | `pnpm turbo gen package` | `turbo/generators/templates/*` | Create conformant packages inside this monorepo. |
| Internal example scaffold | Refarm maintainers | `pnpm turbo gen example` | `turbo/generators/templates/example-*` | Create DGK workbench examples inside this monorepo. |
| Internal app scaffold | Refarm maintainers | `pnpm turbo gen app` | `turbo/generators/templates/app-*` | Create app host skeletons inside this monorepo. |
| Internal validation scaffold | Refarm maintainers | `pnpm turbo gen validation` | `turbo/generators/templates/validation-*` | Create validation proof skeletons inside this monorepo. |
| Public project scaffold | Refarm users and community | `refarm init` / `SowerCore.scaffold` | `templates/*` | Create user-facing workspaces or plugins outside this monorepo. |

Internal scaffolds are coupled to Turbo, workspace invariants,
`scripts/validate-packages.mjs`, and `scripts/ci/check-scaffold-inventory.mjs`.
Public project scaffolds must stay useful outside the monorepo and should depend
on stable Refarm packages or narrow runtime contracts rather than internal
implementation details.

`pnpm run scaffold:inventory` is the map. `pnpm run scaffold:inventory:strict`
is the gate: it fails when a workspace still needs a generator or when public
Sower templates contain build/cache output that would be copied to consumers.
Local cache entries already skipped by Sower, such as `.turbo`, are tolerated so
validation can run without making the factory dirty.

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
  - **Configuration**: Verify that `.refarm/config.json` is generated with the correct parameters.
  - **Identity**: Verify that the `.refarm/identity.json` metadata is correctly initialized.
- **Cleanup**: Tests must clean up their sandboxes after completion.

## 3. Public Template Iteration

When adding a new public project template:
1. Create the template structure in `templates/[template-name]`.
2. Add `templates/[template-name]/refarm.template.json` with the template `id`, source subdirectory, scaffold config, exclusions, expected files, and forbidden output paths.
3. Add a new test case in `core.test.ts` to verify hydration of the new template.
4. Run `pnpm run scaffold:templates:test`, `pnpm -C packages/sower run test`, and `pnpm run scaffold:inventory:strict` to verify.

The default public app template is `workspace`, hydrated from
`templates/workspace/typescript`.

Sower skips `.astro`, `.turbo`, `dist`, and `node_modules` during hydration.
Other generated output inside a public template, such as `target/` or `pkg/`,
is treated as a factory bug because it would be copied into the generated
project.

Template manifest shape:

```json
{
  "schemaVersion": 1,
  "id": "workspace",
  "source": "typescript",
  "config": {
    "type": "app"
  },
  "exclude": [],
  "expectedFiles": [
    "README.md",
    "package.json"
  ],
  "forbiddenPaths": [
    ".turbo",
    "dist",
    "node_modules"
  ]
}
```

`exclude` is relative to the template source and is applied during hydration.
Use it for template-only files that must stay in the monorepo, such as
`refarm.template.json`, package-workspace metadata, or Turbo config.
`expectedFiles` and `forbiddenPaths` are verified by
`pnpm run scaffold:templates:test`.

Files under `docs/examples/*` are examples or research sketches, not scaffold
inputs. Do not make `refarm init` depend on them without first promoting the
example into `templates/*` and adding hydration tests.

## 4. Internal Turbo Template Iteration

When changing internal Turbo scaffolds:

1. Edit `turbo/generators/config.ts` or files under `turbo/generators/templates/*`.
2. Keep generated packages aligned with `scripts/validate-packages.mjs`.
3. Keep generator coverage aligned with `pnpm run scaffold:inventory`.
4. Add or update `scripts/ci/test-turbo-generators.mjs` before broadening scaffold types. The test materializes representative app/example/validation workspaces in a temporary island and requires `scaffold:inventory` to classify them as covered.
5. Run the relevant focused checks:

```bash
pnpm run scaffold:generators:test
pnpm run scaffold:templates:test
pnpm run scaffold:inventory:test
pnpm run scaffold:inventory:strict
pnpm run validate-packages
```

---

> "Scaffold in isolated directories so the repository stays reproducible."
