# Rules of Engagement for the Sovereign Farm

This document defines the constraints and expectations for AI Agents working on the Refarm monorepo.

## 1. Source Sovereignty
- **Source is Truth**: All edits must happen in `src/` or source-level directories.
- **NEVER Edit Artifacts**: Manual edits to `dist/`, `build/`, `.turbo/`, or any directory ignored by `.gitignore` are strictly prohibited. These files are ephemeral and non-reproducible.

## 2. The Build Cycle
- **Build to Verify**: If a change in one package affects another, you MUST run `npm run build` in the dependency package to synchronize type definitions and distribution files.
- **No Cheat-Fixes**: Do not bypass TypeScript or Lint errors by editing generated `.d.ts` files. Fix the root cause in the source or the build configuration.

## 3. Atomic Hygiene & Tooling
- **Deterministic Alignment**: NEVER spend cognitive cycles trying to guess where a package is pointing. Use the existing tooling:
  - Run `node scripts/reso.mjs status` to see the current resolution state.
  - Use `node scripts/reso.mjs src` to toggle to local development or `dist` for production validation.
- **Git Discipline**: Large, sweeping changes should be avoided. Prefer atomic, logical commits.
- **Health first**: Always run `refarm health` (once available in `@refarm.dev/cli`) after significant refactors.

## 4. Hybrid Awareness
- **Sovereign Stratification**: This monorepo is HÍBRIDO. 
  - If a package has `tsconfig.build.json`, it is **TS-Strict** (source is `.ts`, `.js` in `src/` are artifacts).
  - If it lacks TS configuration, it is **JS-Atomic** (source is `.js`).
- **Careful Cleaning**: Never run global `rm -f src/*.js` without verifying package nature first.

## 5. Documentation Continuity
- **Project Repository**: Document technical decisions, architectural changes, and progress in the project's official `docs/` or `README.md` files.
- **Sovereign Knowledge**: Ensure that all knowledge generated during a session is transitioned into the project's source or standard documentation areas to remain accessible to all contributors.

## 6. CI/CD Composability & Hygiene
- **Immutable Actions**: Always use the full 40-character commit hash for third-party GitHub Actions (e.g., `actions/checkout@de0fac2e...`). This ensures the build is deterministic and protected against tag floating.
- **Workflow Reuse**: Use reusable workflows (`workflow_call`) and local actions (`./.github/actions/...`) to promote DRY principles and composition.
- **Lean Modifications**: When editing `.github/workflows/`, make minimal, targeted changes. Avoid large-scale re-indents or sweeping re-ordering that obscures the logical diff.
- **Wrapper Logic**: Prefer encapsulating complex build or test logic into local script "wrappers" (e.g., `npm run test:conformance`) rather than long, multi-line `run` blocks in YAML.

---

> "We cultivate the code as we cultivate the soil: with patience, honesty, and respect for the cycle."
