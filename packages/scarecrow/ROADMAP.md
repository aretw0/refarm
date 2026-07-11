# Scarecrow (Policy & Validation) - Roadmap

**Current Version**: v0.1.0-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## v0.1.0 - Runtime citizenship auditor (IMPLEMENTED)
**Scope**: A passive runtime auditor over the telemetry bus. This is what the
package actually is today — not an ingress policy/enforcement engine. The
capability-admission decision (block excess permission, review-first install,
denied-capability receipt) lives in `@refarm.dev/plugin-manifest`
(`decidePluginPolicy`); Scarecrow's legitimate role is to emit the audit
receipt/telemetry once such a decision exists upstream.

### Implemented
- [x] Passive telemetry observer (`ScarecrowPlugin` over `host.observe`).
- [x] Performance citizenship: throttle a plugin's headless state when
  `ui:performance` `updateVelocity` exceeds a configurable threshold.
- [x] Accessibility citizenship: alert on low `ui:a11y_audit` score.
- [x] Strobe/seizure-hazard alert on `ui:strobe_alert`.
- [x] Config loaded from a `ScarecrowConfig` graph node, hot-updatable via
  `system:config_updated`.
- [x] In-memory alert log + `getSystemHealth()` decay score.

### Not built (previously mis-marked DONE — corrected 2026-07-03)
- [ ] `scarecrow` policy contract / JSON-LD node validation schema.
- [ ] Node rejection on failing policy check (ingress gate).
- [ ] Heartwood signature verification before plugin registration.
- [ ] Policy matching / rule evaluation engine.
- [ ] Node.js and Browser validation adapters.

---

## v0.2.0 - Sovereign Graph Protection
**Scope**: Enforcing policies at the storage and sync boundaries.

- [ ] Implementation of **Ingestion Filtering**: Automatically running Scarecrow checks during `Sower` ingestion.
- [ ] **Sync Validation**: Rejecting incoming sync deltas from `Sync-Loro` if they violate user-defined policies.

---

## v0.3.0 - Sovereign Web Guardian
**Scope**: Protecting the user from external web threats via the Refarm distros.

- [ ] Implementation of **Intent Policy Gating**: Enforcing user approval for high-risk sovereign intents.
- [ ] **Malicious Node Detection**: (Planned) Using `plugin-tem` to detect structural anomalies that indicate malicious injection.

---

## Notes
- See [packages/scarecrow/src/index.ts](./src/index.ts) for core logic.
- The "Guardian" of the sovereign farm — today a citizenship auditor that keeps
  misbehaving UI (performance/a11y/strobe) from harming the user's experience.
  The policy/enforcement "Guardian" framing in the README is aspirational; the
  ingress decision itself is owned upstream by `@refarm.dev/plugin-manifest`.
