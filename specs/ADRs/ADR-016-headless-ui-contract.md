# ADR-016: Headless UI Contract and Token Strategy

**Status**: Proposed  
**Date**: 2026-03-07  
**Decision Drivers**:

- Plugin extensibility requires UI contract without visual coupling
- Browser-first architecture demands accessibility and internationalization by default
- Ecosystem growth depends on consistent component behavior across core and plugins
- Guest mode onboarding demands zero-friction UI with sane defaults

**Related**: 
- [Design System Bootstrap Discussion](../../docs/research/design-system-bootstrap-discussion.md)
- [A11Y & i18n Guide](../../docs/A11Y_I18N_GUIDE.md)
- ADR-008: Ecosystem Technology Boundary

---

## Context

Refarm's competitive differentiation relies on WASM plugin sandbox, JSON-LD portability, and guest mode onboarding. To sustain these advantages, the UI layer must be:

1. **Extensible by third parties** without breaking core UX patterns.
2. **Accessible by default** (WCAG 2.2 AA) to avoid retrofit debt.
3. **Internationalized by default** to support global adoption.
4. **Headless by design** to allow theming without coupling.

**Current situation:**

- `apps/studio` implements UI components ad-hoc without shared primitives.
- No formal contract for keyboard navigation, focus management, or ARIA semantics.
- No standardized i18n strategy for component-level strings.
- Plugins will need UI extension points (dialogs, menus, forms) but have no stable API.

**Why this decision is needed now:**

- Phase 1 roadmap includes plugin SDK with UI extension (v0.2.0+).
- Early stages are ideal for establishing UI quality gates before technical debt accumulates.
- Competitive analysis shows UI consistency gaps as major weakness in open-source alternatives (SilverBullet, Logseq).

---

## Decision

**We will implement a phased headless UI system with mandatory accessibility and internationalization contracts.**

### Phase A (v0.1.0 - v0.2.0): Foundation Bootstrap

Establish minimal UI infrastructure:

1. Create `packages/ui-headless` with 6-8 core primitives:
   - `Button`, `Dialog`, `Menu`, `Tabs`, `Toast`, `FormField`, `Listbox`, `Combobox`

2. Create `packages/ui-tokens` with semantic design tokens:
   - Color (semantic: primary, surface, error, etc.)
   - Spacing (scale: 0-16)
   - Typography (scale + weight)
   - Motion (duration + easing)

3. Establish Definition of Done for UI components:
   - ✅ Keyboard navigation complete (Tab, Enter, Escape, Arrow keys)
   - ✅ Focus management for modals and overlays
   - ✅ ARIA roles and labels appropriate
   - ✅ All user-facing text via translation keys
   - ✅ Tests for keyboard interaction and focus traps

4. Migrate `apps/studio` core components to use primitives.

### Phase B (v0.3.0 - v0.5.0): Internal Productization

Stabilize internal usage:

1. Component catalog with real-world composition examples.
2. Translation guidelines for component-level copy.
3. Automated accessibility testing in CI (axe-core + Playwright).
4. Metrics tracking: a11y regression rate, i18n coverage, component duplication.

### Phase C (v0.6.0+): Externalization

Open stable API for ecosystem:

1. Public component API with versioning policy.
2. Plugin developer guide for UI composition without breaking contracts.
3. Breaking change policy with migration paths.

---

## Alternatives Considered

### Option 1: No Shared UI System (Everyone Implements Own)

**Pros:**

- Zero upfront cost.
- Maximum flexibility for innovation.

**Cons:**

- Guaranteed divergence and poor UX for users.
- Accessibility and i18n become per-component problems (high failure rate).
- Plugin ecosystem will have inconsistent behavior (degrades value proposition).
- Competitive disadvantage vs polished alternatives (Obsidian, Anytype).

**Verdict**: Rejected. Creates long-term structural debt that blocks ecosystem growth.

### Option 2: Full Design System from Day 1

**Pros:**

- Complete consistency from start.
- Professional appearance.

**Cons:**

- High upfront investment before product-market fit.
- Risk of premature abstraction (patterns not yet clear).
- Slow feature delivery in critical early phases.

**Verdict**: Rejected. Over-investment too early, slows down validation.

### Chosen: Option 3 (Phased Headless UI)

**Rationale:**

- Balances upfront investment with iterative learning.
- Headless pattern decouples behavior from visual identity (flexibility).
- Mandatory a11y/i18n contracts prevent retrofit cost.
- Phased externalization allows internal stabilization before ecosystem exposure.

---

## Consequences

### Positive

- Plugin developers inherit accessible, internationalized components by default.
- Consistent keyboard navigation and focus management across core and plugins.
- Reduced review burden for UI PRs (automated contract checks).
- Competitive advantage: only PKM tool with WCAG 2.2 AA + plugin sandbox + headless UI.
- Guest mode onboarding UX benefits from polished primitives.

### Negative

- Initial velocity reduction during Phase A bootstrap (~1-2 sprints).
- Learning curve for contributors unfamiliar with headless patterns.
- Maintenance burden of ui-headless and ui-tokens packages.
- Risk of contract churn between Phase A and Phase C (API stabilization takes time).

### Risks & Mitigations

- **Risk**: Premature API stabilization limits future innovation.
  - **Mitigation**: Delay Phase C (external API) until internal usage proves contracts (Phase B metrics).

- **Risk**: Contributors bypass primitives for speed.
  - **Mitigation**: Make ui-headless usage a quality gate (CI checks + PR template).

- **Risk**: Translation key management becomes bottleneck.
  - **Mitigation**: Use structured keys with namespaces (`ui.button.save`, `ui.dialog.title`).

---

## Implementation

### Package Structure

```
packages/
├── ui-headless/
│   ├── src/
│   │   ├── button/
│   │   │   ├── button.ts (behavior logic)
│   │   │   ├── button.test.ts (keyboard, ARIA, focus)
│   │   │   └── button.stories.ts (visual examples)
│   │   ├── dialog/
│   │   ├── menu/
│   │   └── index.ts
│   ├── package.json
│   └── tsconfig.json
│
├── ui-tokens/
│   ├── src/
│   │   ├── tokens/
│   │   │   ├── color.ts
│   │   │   ├── spacing.ts
│   │   │   ├── typography.ts
│   │   │   └── motion.ts
│   │   └── index.ts
│   ├── package.json
│   └── tsconfig.json
```

### Definition of Done for UI Components

Before merging any new component to `packages/ui-headless`:

```markdown
- [ ] Keyboard navigation complete (Tab, Enter, Escape, Arrow keys)
- [ ] Focus management for modals and overlays (trap focus, restore on close)
- [ ] ARIA roles, labels, and live regions appropriate
- [ ] All user-facing text uses translation keys (no hardcoded strings)
- [ ] Vitest tests for keyboard interaction pass
- [ ] Playwright tests for focus management pass
- [ ] axe-core accessibility audit passes (no violations)
- [ ] Component documented with usage examples
- [ ] Tokens used for all visual properties (no magic values)
```

### Technology Choices

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Component primitives | Lit Web Components | Browser-native, framework-agnostic, small bundle |
| Tokens | CSS Custom Properties | Runtime theming, no build step |
| A11y testing | axe-core + Playwright | Industry standard, CI-friendly |
| i18n runtime | @lit/localize | Lit-native, ICU MessageFormat support |
| Type safety | TypeScript 5.5+ | Contracts as code |

### CI Quality Gates

```yaml
# .github/workflows/ui-quality.yml
name: UI Quality Gates

on: [pull_request]

jobs:
  a11y:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run test:a11y -- packages/ui-headless
      
  i18n:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run check:i18n-keys
      
  keyboard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run test:keyboard -- packages/ui-headless
```

### Migration Plan for apps/studio

```typescript
// Before (ad-hoc button)
<button @click=${this.handleSave}>Save</button>

// After (headless primitive)
import { Button } from '@refarm/ui-headless';

<rf-button @click=${this.handleSave}>
  ${msg('Save')}
</rf-button>
```

---

## Validation

**Success metrics (Phase A complete):**

- [ ] 100% of interactive components in `apps/studio` use `ui-headless` primitives
- [ ] 0 axe-core violations in CI for core UI
- [ ] 100% of user-facing strings use translation keys
- [ ] Keyboard navigation covers all critical paths (tested in Playwright)

**Success metrics (Phase B complete):**

- [ ] Average PR review time for UI reduced by 30%
- [ ] Zero a11y regressions for 2 consecutive releases
- [ ] Component duplication rate < 5%

**Success metrics (Phase C complete):**

- [ ] ≥1 external plugin successfully uses `ui-headless` API
- [ ] API breaking change rate < 1 per minor version

---

## References

- [Design System Bootstrap Discussion](../../docs/research/design-system-bootstrap-discussion.md)
- [A11Y & i18n Implementation Guide](../../docs/A11Y_I18N_GUIDE.md)
- [Competitive Analysis - UI Gap Analysis](../../docs/research/competitive-analysis.md#estruturação-do-design-system-headless-prioridade-transversal)
- [Lit Web Components](https://lit.dev/)
- [WCAG 2.2 Level AA](https://www.w3.org/WAI/WCAG22/quickref/)
- [WAI-ARIA Practices Guide](https://www.w3.org/WAI/ARIA/apg/)
