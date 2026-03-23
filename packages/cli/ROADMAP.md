# CLI - Roadmap

**Current Version**: v0.1.0-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## v0.1.0 - Core Tooling (DONE)
**Scope**: Establish the core `refarm` command and workspace resolution logic.  
**Gate**: `refarm` command available and correctly resolving packages.

### SDD (Spec Driven) ✅
- [x] Spec: Command-line interface structure (Commander.js).
- [x] Spec: Integration with `reso.mjs` for atomic resolution.
- [x] Spec: Workspace discovery logic.

### BDD (Behaviour Driven) ✅
- [x] Integration: `refarm` lists available packages.
- [x] Integration: `refarm status` reports correct resolution state.
- [x] Integration: Binary linked and globally available in dev environment.

### TDD (Test Driven) ✅
- [x] Unit: Command parsing and argument validation.
- [x] Unit: Workspace path resolution logic.
- [x] Coverage: >80%

### DDD (Domain Implementation) ✅
- [x] Domain: Core `CLI` program logic.
- [x] Infra: Node.js bin linking.

---

## v0.2.0 - Self-Healing & Scaffolding
**Scope**: Adding proactive health checks and plugin developer experience.

- [ ] Implementation of **`refarm health`**: Running automated diagnostic checks on the monorepo (TypeScript, Lint, Build artifacts).
- [ ] **`refarm create plugin`**: Scaffolding new WASM plugins with the correct WIT and project structure.
- [ ] Integration with `Barn` for local plugin validation.

---

## v0.3.0 - Publishing & Verification
**Scope**: Hardened workflows for publishing plugins to the Sovereign Registry.

- [ ] Implementation of **`refarm publish`**: Signing manifests with `Heartwood` and uploading to a registry.
- [ ] **Verification Workflow**: Automated CI-based verification of plugin WIT compliance.

---

## Notes
- Follows the [AGENTS.md](../../AGENTS.md) rules for "Atomic Hygiene".
- The "Swiss Army Knife" for Refarm developers.
