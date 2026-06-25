# Package Acceptance Checklist (Refarm)

> Status: integration checklist (2026-06-25). Every new `packages/*` must clear these gates or
> Refarm CI (`gate:full:colony`) stops. Grounded in the actual gate scripts. Closes convergence
> loose end #2 (a new package was registered in only one of the required lists).

A new package is **not done** when its tests pass — it is done when it is wired into Refarm's
acceptance machinery.

> **Automated:** `turbo gen package` now does steps **2, 3, and 6** for you — pick a `gate`
> (`test:unit` / `test:conformance`) at the prompt and it registers the package in **both**
> `test-capabilities.mjs` and `gate-smoke-contracts.mjs` and emits a `.changeset/<name>.md`.
> (Generator: `turbo/generators/config.ts`.) The list below is the **manual fallback** — for
> packages not created via the generator, or existing packages gaining a new gated test entry.

For each new package (manual fallback / verification):

1. **Scaffold classification** — `scripts/validate-packages.mjs` auto-classifies every `packages/*`
   by convention; match a canonical type so no extra fields are needed:
   - **contract-v1**: `main` = `./dist/index.js`, a `src/conformance.ts`, and a `build` script that
     runs `tsc`. (e.g. `source-contract-v1`.)
   - **adapter / buildable**: `main` = `./dist/...`, `tsc` build, and a `test:conformance` script
     running against an imported suite. (e.g. `source-git`.)
   - **escape hatch** if it fits no type: `"scaffold": { "type": "exempt", "reason": "..." }` in
     `package.json`.
   - verify: `pnpm run validate-packages`.

2. **Capability gate** — add `["packages/<name>", "test:unit" | "test:conformance"]` to the `STEPS`
   array in `scripts/ci/test-capabilities.mjs`.

3. **Contracts smoke gate** — add **both** `["packages/<name>", "build"]` and
   `["packages/<name>", "test:unit" | "test:conformance"]` to the `STEPS` array in
   `scripts/ci/gate-smoke-contracts.mjs`. **This is a separate list from #2 — easy to miss.**

4. **Build order** — internal deps (e.g. `source-git` → `source-contract-v1`) build via Turbo
   `dependsOn`; verify `pnpm run task:build-order:check`.

5. **Workspace ownership** — verify `pnpm run workspace:source:ownership` passes for the new
   directory; add an ownership entry if the check requires one.

6. **Release entry** — add a `.changeset/*.md` (model: `.changeset/initial-contracts-release.md`)
   unless the package belongs in `.changeset/config.json` `ignore`. Default access is `public`,
   `baseBranch` is `main`.

7. **Local pre-commit gate** — green before committing:
   `pnpm run validate-packages && pnpm run gate:smoke:contracts && pnpm run test:capabilities`.

## Applies to

- **Item 1 (new packages):** `source-contract-v1` (contract-v1 type), `source-git` (adapter type) —
  full checklist.
- **Item 4 (existing packages, new surface):** `ds`, `homestead`, `silo` already exist — for them
  #2/#3 apply to the **new** test entries (e.g. `ds` theme conformance, `homestead/ssr`,
  `silo` collect), and #6 (changeset) applies to the changed packages. No re-scaffold.
