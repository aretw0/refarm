# Rules of Engagement for the Sovereign Farm

This document defines the constraints and expectations for AI Agents working on the Refarm monorepo.

## 0. Epistemic Framework (Active Inference)

These rules are not arbitrary — they derive from a unified cognitive model:

**AI agents in this repository operate under Active Inference.** Each rule below is an operational instance of an epistemic principle:

- **Generative Model**: `src/` is the system's internal causal model. Artifacts (`dist/`) are derived observations — never edit an observation, fix the model.
- **Action as Sampling**: Builds, tests, and `reso.mjs status` are actions that sample the environment to reduce uncertainty before deciding.
- **Calibrated Precision**: Use existing tooling (`reso.mjs`, `npm run build`) to assess current state reliability. Never assume — measure.
- **Complexity Minimization**: Prefer atomic changes. Surprise (unexpected errors) scales with delta size. Small commits = lower free energy.
- **Markov Blanket**: You interact with the repository exclusively through reads (files, tooling output) and writes to `src/`. Never assume direct access to runtime state or generated artifacts.

## 1. Source Sovereignty
- **Source is Truth**: All edits must happen in `src/` or source-level directories.
- **NEVER Edit Artifacts**: Manual edits to `dist/`, `build/`, `.turbo/`, or any directory ignored by `.gitignore` are strictly prohibited. These files are ephemeral and non-reproducible.

> *Active Inference*: keep the internal model (`src/`) consistent with observations. Editing an artifact is editing a shadow, not the cause.

## 2. The Build Cycle
- **Build to Verify**: If a change in one package affects another, you MUST run `npm run build` in the dependency package to synchronize type definitions and distribution files.
- **No Cheat-Fixes**: Do not bypass TypeScript or Lint errors by editing generated `.d.ts` files. Fix the root cause in the source or the build configuration.

> *Active Inference*: a build is a perception act — it samples reality to confirm the model's predictions. Skip it and you're acting blind.

## 3. Atomic Hygiene & Tooling
- **Deterministic Alignment**: NEVER spend cognitive cycles trying to guess where a package is pointing. Use the existing tooling:
  - Run `node scripts/reso.mjs status` to see the current resolution state.
  - Use `node scripts/reso.mjs src` to toggle to local development or `dist` for production validation.
- **Git Discipline**: Large, sweeping changes should be avoided. Prefer atomic, logical commits.
  - Health first: Always run `refarm health` (once available in `@refarm.dev/cli`) after significant refactors.
  - Plugin Integrity: Leverage the `Barn` (`@refarm.dev/barn`) for managing plugin lifecycles and ensuring their integrity (SHA-256 validation) before deployment.

> *Active Inference*: `reso.mjs status` calibrates precision — it tells you how reliable the current environment signal is before you act on it.

## 4. Hybrid Awareness
- **Sovereign Stratification**: This monorepo is HÍBRIDO.
  - If a package has `tsconfig.build.json`, it is **TS-Strict** (source is `.ts`, `.js` in `src/` are artifacts).
  - If it lacks TS configuration, it is **JS-Atomic** (source is `.js`).
- **Careful Cleaning**: Never run global `rm -f src/*.js` without verifying package nature first.

> *Active Inference*: recognizing a package's nature reduces the model's complexity — acting without this knowledge maximizes surprise.

## 5. Documentation Continuity
- **Project Repository**: Document technical decisions, architectural changes, and progress in the project's official `docs/` or `README.md` files.
- **Sovereign Knowledge**: Ensure that all knowledge generated during a session is transitioned into the project's source or standard documentation areas to remain accessible to all contributors.

> *Active Inference*: documentation is the agent's only durable output channel. Knowledge that stays in the session context is lost — write it or it never existed.

## 6. CI/CD Composability & Hygiene
- **Immutable Actions**: Always use the full 40-character commit hash for third-party GitHub Actions (e.g., `actions/checkout@de0fac2e...`). This ensures the build is deterministic and protected against tag floating.
- **Workflow Reuse**: Use reusable workflows (`workflow_call`) and local actions (`./.github/actions/...`) to promote DRY principles and composition.
- **Lean Modifications**: When editing `.github/workflows/`, make minimal, targeted changes. Avoid large-scale re-indents or sweeping re-ordering that obscures the logical diff.
- **Wrapper Logic**: Prefer encapsulating complex build or test logic into local script "wrappers" (e.g., `npm run test:conformance`) rather than long, multi-line `run` blocks in YAML.

> *Active Inference*: pinned hashes and reusable workflows minimize environmental drift — a stable environment produces predictable outcomes and lowers surprise.

---

> "We cultivate the code as we cultivate the soil: with patience, honesty, and respect for the cycle."
