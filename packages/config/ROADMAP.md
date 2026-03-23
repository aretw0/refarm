# Config (Sovereign Settings) - Roadmap

**Current Version**: v0.1.0-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## v0.1.0 - Hierarchy Foundation (DONE/In Progress)
**Scope**: Establish the core settings hierarchy and override logic.  
**Gate**: Verified local file and environment variable overrides.

### SDD (Spec Driven) ✅
- [x] Spec: Configuration hierarchy (Defaults → User → Env).
- [x] Spec: JSON-based configuration schema.

### BDD (Behaviour Driven) ✅
- [x] Integration: `Tractor` correctly reads config from `.refarm` directory.
- [x] Integration: Environment variables correctly override local settings.

### TDD (Test Driven) ✅
- [x] Unit: Configuration merging and priority resolution.
- [x] Coverage: >80%

### DDD (Domain Implementation) ✅
- [x] Domain: Core `config` logic.
- [x] Infra: Node.js file system configuration loader.

---

## v0.2.0 - Configuration as a Node
**Scope**: Distributing system settings via the Sovereign Graph.

- [ ] Implementation of **Graph-Level Overrides**: Allowing the user to change system settings by editing nodes in their graph.
- [ ] **Reactive Config**: Notifying active plugins when their configuration nodes change.

---

## v0.3.0 - Policy-Driven Config
**Scope**: Integrating `scarecrow` to validate configuration changes.

- [ ] Implementation of **Config Safeguards**: Ensuring that sensitive settings (e.g. key derivation paths) cannot be changed to insecure values.
- [ ] **Versioned Settings**: Git-like history for all configuration changes.

---

## Notes
- See [packages/config/src/index.js](./src/index.js) for core logic.
- The "Seasonal Calendar" of the sovereign farm — defining the rules and timing of the ecosystem.
