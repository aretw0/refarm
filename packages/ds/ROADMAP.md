# Design System (DS) - Roadmap

**Current Version**: v0.1.0-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## v0.1.0 - Token Foundation (DONE/In Progress)
**Scope**: Establish core CSS tokens and Storybook integration.  
**Gate**: Verified token accessibility and Storybook deployment.

### SDD (Spec Driven) ✅
- [x] Spec: Semantic token structure (Color, Spacing, Typography).
- [x] Spec: Storybook configuration for Refarm components.
- [x] Spec: CSS-in-JS vs Vanilla CSS strategy (Decision: Vanilla CSS with tokens).

### BDD (Behaviour Driven) ✅
- [x] Integration: CSS tokens correctly applied across `Homestead`.
- [x] Integration: Dark/Light mode switching via tokens.
- [x] Integration: Storybook displays all primitive tokens.

### TDD (Test Driven) ✅
- [x] Unit: Token value consistency checks.
- [x] Unit: Build process outputs valid CSS.

### DDD (Domain Implementation) ✅
- [x] Domain: Core `ds` style library.
- [x] Infra: Storybook and build pipeline.

---

## v0.2.0 - Headless UI Primitives
**Scope**: Developing accessible, logic-only components for plugin authors.

- [ ] Implementation of **Headless Primitives**: Tab, Dialog, Popover, and Input contracts.
- [ ] **A11y Compliance**: Ensuring every primitive meets WCAG 2.1 AA standards.

---

## v0.3.0 - UI-as-a-Node
**Scope**: Distributing design system configurations via the Sovereign Graph.

- [ ] Implementation of **Dynamic Token Injection**: Loading design system tokens from the user's graph nodes at runtime.
- [ ] **Branding nodes**: Allowing the graph to override visual styling for specific distros.

---

## Notes
- See [packages/ds/package.json](./package.json) for scripts.
- The "Soil and Color" of the sovereign farm — ensuring a consistent and beautiful world.
