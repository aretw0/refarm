# UI Component Pull Request Checklist

**Component(s) affected**: <!-- Button, Dialog, FormField, etc. -->

---

## 📋 Pre-Merge Quality Gates

### Accessibility (WCAG 2.2 AA)

- [ ] **Keyboard navigation complete**
  - Tab order logical
  - Enter/Space activates interactive elements
  - Escape closes overlays/dismisses transient UI
  - Arrow keys for list/grid navigation (if applicable)

- [ ] **Focus management**
  - Visible focus indicator on all interactive elements
  - Focus trapped in modals/dialogs (cannot tab to background)
  - Focus restored to trigger element on modal close
  - No keyboard traps (user can always escape)

- [ ] **ARIA and semantics**
  - Appropriate ARIA roles (`role="button"`, `role="dialog"`, etc.)
  - Labels present (`aria-label` or `aria-labelledby`)
  - States communicated (`aria-expanded`, `aria-pressed`, `aria-checked`)
  - Live regions for dynamic content (`aria-live`, `role="alert"`)
  - Native HTML semantics used when possible (`<button>`, `<nav>`, etc.)

- [ ] **axe-core tests pass**
  ```bash
  npm run test:a11y -- packages/ui-headless
  ```

### Internationalization (i18n)

- [ ] **All user-facing text uses translation keys**
  - No hardcoded strings in component logic
  - Keys structured with namespaces (`ui.button.save`, `ui.dialog.close`)
  - Fallback locale defined

- [ ] **ICU MessageFormat for complex strings**
  - Pluralization: `{count, plural, one {# item} other {# items}}`
  - Variables: `Welcome, {name}!`

- [ ] **Translation keys added to all locale files**
  - `locales/pt-BR.json`
  - `locales/en.json`
  - `locales/es.json`

- [ ] **i18n validation passes**
  ```bash
  npm run check:i18n-keys
  ```

### Headless UI Contract

- [ ] **Component uses tokens (no magic values)**
  - Colors via `ui-tokens` (e.g., `var(--color-primary)`)
  - Spacing via scale (e.g., `var(--spacing-4)`)
  - Typography via scale (e.g., `var(--text-md)`)

- [ ] **Behavior separated from style**
  - Component exports state and interaction logic
  - Visual styling optional/customizable
  - Slots provided for composition

- [ ] **TypeScript types exported**
  - Props interface documented
  - Events interface documented
  - Public methods documented

### Testing

- [ ] **Unit tests pass** (Vitest)
  ```bash
  npm run test:unit -- packages/ui-headless
  ```

- [ ] **Integration tests pass** (keyboard interaction)
  ```bash
  npm run test:keyboard -- packages/ui-headless
  ```

- [ ] **E2E tests pass** (Playwright - focus management)
  ```bash
  npm run test:e2e -- packages/ui-headless
  ```

- [ ] **Coverage maintained** (target: >80% for new code)

### Documentation

- [ ] **Component documented with usage examples**
  - Props described
  - Events described
  - Composition patterns shown
  - Accessibility notes included

- [ ] **Storybook story created** (if applicable)
  ```bash
  npm run storybook
  ```

---

## 🧪 Manual Testing Checklist

Test in at least one browser with:

- [ ] **Keyboard only** (no mouse)
  - Can reach all interactive elements via Tab
  - Can activate all actions via Enter/Space
  - Can dismiss overlays via Escape

- [ ] **Screen reader** (optional but recommended)
  - NVDA (Windows) or VoiceOver (macOS)
  - All interactive elements announced with role and label
  - State changes announced (expanded/collapsed, checked/unchecked)

- [ ] **Zoom to 200%** (WCAG SC 1.4.4)
  - Layout does not break
  - No horizontal scrolling (unless table/code)
  - Text remains readable

---

## 📸 Visual Regression (Optional)

If component changes visual appearance:

- [ ] Screenshot attached (before/after)
- [ ] Checked in light and dark mode (if supported)
- [ ] Checked in multiple locales (pt-BR, en, es)

---

## 🔗 Related

- [ADR-016: Headless UI Contract](../specs/ADRs/ADR-016-headless-ui-contract.md)
- [A11Y & i18n Guide](../docs/A11Y_I18N_GUIDE.md)
- [Design System Bootstrap Discussion](../docs/research/design-system-bootstrap-discussion.md)

---

## 📝 Notes

<!-- Any additional context, decisions, or trade-offs made during development -->
