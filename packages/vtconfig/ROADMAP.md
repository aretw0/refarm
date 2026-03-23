# vtconfig (Test Configuration) - Roadmap

**Current Version**: v0.1.0-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## v0.1.0 - Atomic Alias Foundation (DONE)
**Scope**: Establish core Vitest alias generation for `src` vs `dist` switching.  
**Gate**: Verified alias resolution for core packages in both modes.

### SDD (Spec Driven) ✅
- [x] Spec: `getAliases()` logic for automated path resolution.
- [x] Spec: Environment variable triggers (`VITEST_USE_DIST`, `VITEST_FORCE_DIST`).
- [x] Spec: Shared `baseConfig` for all Vitest configurations in the monorepo.

### BDD (Behaviour Driven) ✅
- [x] Integration: Tests run against `src` by default.
- [x] Integration: Tests run against `dist` when `VITEST_USE_DIST=true` is set.
- [x] Integration: Single package can be forced to `dist` for integration testing.

### TDD (Test Driven) ✅
- [x] Unit: Alias path calculation logic.
- [x] Unit: Environment variable parsing.
- [x] Coverage: >80%

### DDD (Domain Implementation) ✅
- [x] Domain: Core `vtconfig` logic in `index.js`.
- [x] Infra: Node.js file system traversal for package discovery.

---

## v0.2.0 - Health Integration
**Scope**: Linking test configuration to the `refarm health` diagnostic suite.

- [ ] Implementation of **Alias Integrity Checks**: Cross-referencing Vitest aliases with `package.json` exports to detect drift.
- [ ] **Automated Test Matrix**: Scripting the execution of tests across all combinations of `src` and `dist` for major dependencies.

---

## v0.3.0 - Dynamic Resolution Signals
**Scope**: Enabling real-time resolution switching without environment restarts.

- [ ] Implementation of **Resolution Watcher**: Detecting when a package build finishes and automatically switching aliases if in "Auto-Dist" mode.
- [ ] **Studio Integration**: Providing a UI in `apps/dev` to toggle test resolution modes per-package.

---

## Notes
- See [packages/vtconfig/src/index.js](./src/index.js) for core logic.
- The "Switchboard" of the sovereign farm — ensuring the right signals reach the right tests.
