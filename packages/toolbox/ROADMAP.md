# Toolbox (Developer Utilities) - Roadmap

**Current Version**: v0.1.0-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## v0.1.0 - Atomic Foundations (DONE/In Progress)
**Scope**: Establish core shared scripts and automation tools.  
**Gate**: Verified `git-commit-auto` and shared build logic.

### SDD (Spec Driven) ✅
- [x] Spec: `git-commit-auto` logic (Atomic intent grouping).
- [x] Spec: Shared Vite/Vitest configuration patterns.

### BDD (Behaviour Driven) ✅
- [x] Integration: Developers perform atomic commits via `npm run git-commit-auto`.
- [x] Integration: Build processes consistently emit artifacts in `dist/`.

### TDD (Test Driven) ✅
- [x] Unit: Git grouping logic and metadata parsing.
- [x] Coverage: >75%

### DDD (Domain Implementation) ✅
- [x] Domain: Core `toolbox` scripts.
- [x] Infra: Node.js and Shell scripting integration.

---

## v0.2.0 - Sovereign Toolchain
**Scope**: Refining the developer experience with specialized Refarm tools.

- [ ] Implementation of **WASM Scaffolding Utilities**: Automating the `cargo component` + `jco transpile` pipeline for all packages.
- [ ] **Monorepo Stats**: Providing a unified view of monorepo health and size via Toolbox scripts.

---

## v0.3.0 - Autonomous Tooling
**Scope**: Integrating `plugin-tem` and `windmill` to automate monorepo maintenance.

- [ ] Implementation of **Auto-Fixer Workflows**: Toolbox scripts that use Windmill to automatically fix common lint or formatting issues.
- [ ] **Sovereign Releases**: Automating versioning and publishing based on graph-stored intent.

---

## Notes
- See [packages/toolbox/package.json](./package.json) for available scripts.
- The "Tool Shed" of the sovereign farm — maintaining the machinery of the monorepo.
