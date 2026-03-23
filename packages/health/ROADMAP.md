# Health (Diagnostics) - Roadmap

**Current Version**: v0.1.0-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## v0.1.0 - Monorepo Integrity (DONE/In Progress)
**Scope**: Establish core diagnostic checks for the developer environment.  
**Gate**: Verified TS/Lint/Build status reports.

### SDD (Spec Driven) ✅
- [x] Spec: `refarm:health` contract for monorepo validation.
- [x] Spec: Integration with `Turbo` and `Vitest` for health signals.

### BDD (Behaviour Driven) ✅
- [x] Integration: CLI correctly reports if a package is "Healthy" or "Broken".
- [x] Integration: Missing build artifacts detected during `refarm status`.

### TDD (Test Driven) ✅
- [x] Unit: Path validation and artifact presence checks.
- [x] Coverage: >80%

### DDD (Domain Implementation) ✅
- [x] Domain: Core `health` check logic.
- [x] Infra: Node.js monorepo inspector.

---

## v0.2.0 - `refarm health` Command
**Scope**: Delivering a first-class developer diagnostic tool.

- [ ] Implementation of **`refarm health` (CLI)**: Full diagnostic suite with colored reports and fix suggestions.
- [ ] **Schema Validation**: Checking that `identity.json` and `registry.json` match their respective schemas.

---

## v0.3.0 - Runtime Self-Healing
**Scope**: Proactive error detection and recovery in live Refarm distros.

- [ ] Implementation of **Pulse Diagnostics**: Analyzing `Creek` telemetry to trigger automatic plugin restarts or state repairs.
- [ ] **Sovereign Recovery**: Integration with `Silo` for key-based state reconstruction.

---

## Notes
- See [packages/health/src/index.ts](./src/index.ts) for core logic.
- The "Medicine" of the sovereign farm — maintaining the vitality of the ecosystem.
