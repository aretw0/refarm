# AGENTS.md: Rules of Engagement for the Sovereign Farm

This document defines the constraints and expectations for AI Agents (like Antigravity) working on the Refarm monorepo.

## 1. Source Sovereignty
- **Source is Truth**: All edits must happen in `src/` or source-level directories.
- **NEVER Edit Artifacts**: Manual edits to `dist/`, `build/`, `.turbo/`, or any directory ignored by `.gitignore` are strictly prohibited. These files are ephemeral and non-reproducible.

## 2. The Build Cycle
- **Build to Verify**: If a change in one package affects another, you MUST run `npm run build` in the dependency package to synchronize type definitions and distribution files.
- **No Cheat-Fixes**: Do not bypass TypeScript or Lint errors by editing generated `.d.ts` files. Fix the root cause in the source or the build configuration.

## 3. Atomic Hygiene
- **Git Discipline**: Large, sweeping changes should be avoided. Prefer atomic, logical commits.
- **Health first**: Always run `refarm health` (once available in `@refarm.dev/cli`) after significant refactors to ensure monorepo alignment.

## 4. Documentation Continuity
- **Project Repository**: Document technical decisions, architectural changes, and progress in the project's official `docs/` or `README.md` files.
- **Sovereign Knowledge**: Ensure that all knowledge generated during a session is transitioned into the project's source or standard documentation areas to remain accessible to all contributors.

---

> "We cultivate the code as we cultivate the soil: with patience, honesty, and respect for the cycle."
