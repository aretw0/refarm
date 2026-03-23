# Windmill (Automation) - Roadmap

**Current Version**: v0.1.0-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## v0.1.0 - Provider Foundation (DONE/In Progress)
**Scope**: Establish the core provider interface and initial browser/native providers.  
**Gate**: Verified provider registration and basic task execution logic.

### SDD (Spec Driven) ✅
- [x] Spec: `WindmillProvider` interface.
- [x] Spec: Task definition and execution contract.
- [x] Spec: Browser-based automation provider (DOM, Storage).

### BDD (Behaviour Driven) ✅
- [x] Integration: Register a new provider via `Windmill`.
- [x] Integration: Execute a simple task via a specific provider.
- [x] Integration: Browser-specific automation tasks (e.g. `clear-opfs-cache`).

### TDD (Test Driven) ✅
- [x] Unit: Provider registration and resolution tests.
- [x] Unit: Task parameter validation.
- [x] Coverage: >80%

### DDD (Domain Implementation) ✅
- [x] Domain: Core `Windmill` engine.
- [x] Infra: Browser provider implementation (`index.browser.js`).

---

## v0.2.0 - WASM-based Workflows
**Scope**: Enabling complex, multi-step workflows to run in isolated WASM environments.

- [ ] Implementation of **WASM Workflow Engine**: Standardizing how a WASM plugin can orchestrate multiple tasks across different providers.
- [ ] **Stateful Workflows**: Persisting intermediate workflow state to the Sovereign Graph to enable recovery from crashes or restarts.

---

## v0.3.0 - AI-Driven Automation
**Scope**: Integrating `plugin-tem` intelligence for autonomous decision-making in workflows.

- [ ] Implementation of **Smart Intents**: Triggering workflows based on TEM-detected novelty or relational patterns.
- [ ] **Heuristic Automation**: Enabling the engine to choose the best provider and parameters for a goal-based task.

---

## Notes
- See [packages/windmill/src/index.js](./src/index.js) for core logic.
- The "Mill" of the sovereign farm — grinding heavy tasks into useful outputs.
