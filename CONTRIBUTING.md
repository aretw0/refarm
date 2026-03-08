# Contributing to Refarm

Thank you for your interest in contributing to Refarm! This guide will help you understand our workflow and get started.

---

## Overview

Refarm is a monorepo consisting of:

- **Apps**: Kernel and Studio
- **Packages**: Core primitives (storage, identity, sync)
- **Examples**: Reference implementations

We follow a structured **SDD → BDD → TDD → DDD** workflow with quality gates between phases. See [docs/WORKFLOW.md](docs/WORKFLOW.md) for the complete process.

---

## Development Workflow

### 1. Installation

```bash
npm install
npm run dev      # Start all apps in watch mode
```

### 2. Making Changes

- Create a feature branch from `main`
- Make your changes across one or more packages
- Test your changes locally

### Quality Gates (Local + CI)

Refarm enforces quality with a two-mode pre-push hook and CI checks:

- **Feature branches**: permissive mode (warns, can continue)
- **`main` and `develop`**: strict mode (blocks push on `lint` and `type-check` failures)
- **`test:unit` and security audit**: advisory locally, enforced in CI
- **CI always validates again** on PRs and pushes

Install/update hooks locally:

```bash
npm run hooks:install
```

Useful references:

- Governance policy: `docs/PR_QUALITY_GOVERNANCE.md`
- Branch protection setup: `docs/BRANCH_PROTECTION_SETUP.md`

### 3. Version Management with Changesets

We use [Changesets](https://github.com/changesets/changesets) to manage versioning and publishing. This ensures:

- ✅ Clear changelog entries
- ✅ Semantic versioning across packages
- ✅ Coordinated releases

**For each change, create a changeset:**

```bash
npm run changeset
```

This will prompt you to:

1. Select which packages changed
2. Choose a version bump type (major/minor/patch)
3. Summarize your changes

A markdown file will be created in `.changeset/` — include it in your PR.

### 4. Pull Request

- Create a PR with your changes and the changeset file
- If you're fixing a known issue, reference it (closes #123)
- Ensure all tests pass: `npm run test`

### 5. Versioning & Release (Maintainers Only)

When ready to release:

```bash
npm run build
npm run changeset:version   # Bump versions + update CHANGELOGs
npm run changeset:publish   # Publish to npm
```

---

## Development Guidelines

### Code Quality

- **TypeScript**: Use strict mode (`tsconfig.json`)
- **Linting**: `npm run lint` before committing
- **Testing**: Add tests for new features
- **Build**: `npm run build` should succeed

### Package Independence

Each package should be:

- **Self-contained**: Minimal external dependencies
- **Portable**: Works independently if needed
- **Well-documented**: Clear README per package

### Commit Messages

Use descriptive commit messages:

- ✅ Good: "Add CRDT vector clock implementation"
- ❌ Avoid: "Fix stuff", "WIP", "asdf"

### Diagrams

Diagrams are stored as Mermaid source files (`.mermaid`) with auto-generated SVG renderings.

Global styling is centralized in `specs/diagrams/mermaid.config.json`.

**When you edit a `.mermaid` file:**

1. Regenerate the SVG:

   ```bash
   npm run diagrams:fix
   ```

  This command applies the global Mermaid design system automatically.

1. Commit both the `.mermaid` source AND the `.svg` rendering:

   ```bash

  git add docs/**/*.mermaid docs/**/*.svg specs/diagrams/**/*.mermaid specs/diagrams/**/*.svg
   git commit -m "docs: update diagram"

   ```

3. The CI will verify that SVG files match their source on PRs.

**Why?**

- `.mermaid` is the source of truth (easy to edit, version control-friendly)
- `.svg` is the rendered output (displays correctly on GitHub without extra dependencies)
- Keeping them in sync prevents stale diagrams in documentation

If `npm run diagrams:fix` fails due missing Chromium shared libraries in the devcontainer, do not install ad-hoc only in the running container. Update:
- `.devcontainer/Dockerfile` (image baseline)
- `docs/DEVOPS.md` (dependency tracking section)

---

## Accessibility (a11y)

Refarm targets **WCAG 2.2 Level AA** as a baseline. Accessibility is not an afterthought—build it in from the start.

### Guidelines

**Semantic HTML**:

```html
<!-- ✅ Good -->
<nav>
  <a href="/">Home</a>
</nav>
<main role="main">
  <article>
    <h1>Title</h1>
    <p>Content</p>
  </article>
</main>

<!-- ❌ Avoid -->
<div class="nav">
  <span onclick="...">Home</span>
</div>
```

**ARIA for Web Components**:

```typescript
// Use ARIA labels and roles
render() {
  return html`
    <button aria-label="Close dialog" @click=${this.close}>×</button>
    <div role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <h1 id="dialog-title">Confirm Action</h1>
    </div>
  `;
}
```

**Keyboard Navigation**:

- ✅ All interactive elements must be keyboard accessible
- ✅ Focus must be visible (outline, underline, or highlight)
- ✅ Tab order should be logical (use native elements when possible)
- ✅ Support Escape key for modals/popovers

**Color & Contrast**:

- ✅ Text contrast ratio ≥ 4.5:1 (WCAG AA)
- ✅ Don't rely on color alone to convey information
- ✅ Test with color blindness simulators

### Testing

Before submitting a PR with UI changes, run accessibility checks:

```bash
# Testing with axe-core
npm run test:a11y

# Manual testing
# - Screen reader: NVDA (Windows), VoiceOver (Mac/iOS)
# - Keyboard: Tab through entire page
# - Visual: Check focus states and color contrast
```

### Resources

- [WCAG 2.2 Checklist](https://www.w3.org/WAI/WCAG22/Techniques/)
- [ARIA Authoring Practices Guide (APG)](https://www.w3.org/WAI/ARIA/apg/)
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)

---

## Internationalization (i18n)

Refarm is designed for a global audience. All user-facing text must support multiple languages from day one.

**Phase 1 Languages**: Portuguese (pt-BR), English (en), Spanish (es)

### Workflow

**1. Add translations to locale files**:

```json
// locales/pt-BR.json
{
  "studio.welcome": "Bem-vindo ao Refarm Studio",
  "studio.plugins.count": "{count, plural, one {# plugin} other {# plugins}}"
}
```

**2. Use translations in Astro components**:

```astro
---
import { useTranslation } from "astro-i18next";

const { t, i18n } = useTranslation();
const currentLocale = i18n.language;
---

<h1>{t("studio.welcome")}</h1>
<p>{t("studio.plugins.count", { count: 5 })}</p>
```

**3. Web Components with @lit/localize**:

```typescript
import { msg, str } from '@lit/localize';

render() {
  return html`
    <h1>${msg("Welcome to Refarm")}</h1>
    <p>${msg(str`You have ${this.count} plugins`)}</p>
  `;
}
```

### Best Practices

- ✅ **Never hardcode text** — Always use translation keys
- ✅ **Plan for expansion** — English text often expands 20-30% in translation
- ✅ **Context matters** — Provide context comments for translators:

  ```json
  {
    "studio.save": "Save",  // Button label (keep short)
    "action.save": "Save this change"  // Help text (can be longer)
  }
  ```

- ✅ **Use ICU MessageFormat** for plurals, numbers, dates
- ✅ **Support RTL** for Arabic, Hebrew (CSS `direction: rtl`)
- ✅ **Format dates/numbers** using `Intl` API:

  ```typescript
  new Intl.DateTimeFormat('pt-BR').format(new Date())
  new Intl.NumberFormat('pt-BR', { currency: 'BRL' }).format(123.45)
  ```

### Testing

```bash
# Verify all keys are translated
npm run i18n:check

# Build with all locales
npm run build
```

### Translation Guidelines

- Keep keys hierarchical: `section.subsection.key`
- Use present tense, active voice
- Avoid idioms (hard to translate)
- Mark HTML/variables clearly: `{value}`, `<br />`

### Resources

- [astro-i18next Documentation](https://astro-i18next.pages.dev/)
- [@lit/localize Guide](https://lit.dev/docs/localization/overview/)
- [ICU MessageFormat Syntax](https://unicode-org.github.io/icu/userguide/format_parse/messages/)

---

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for:

- System design overview
- Data flow diagrams  
- Plugin development guide
- JSON-LD schema details

See [docs/WORKFLOW.md](docs/WORKFLOW.md) for:

- Development process (SDD → BDD → TDD → DDD)
- Quality gates between phases
- When to write specs vs tests vs code
- CI/CD enforcement strategies

### Accessibility & Internationalization

See [docs/A11Y_I18N_GUIDE.md](docs/A11Y_I18N_GUIDE.md) for:

- Detailed a11y implementation patterns
- i18n setup and translation workflow
- WCAG 2.2 Level AA standards
- Testing procedures

---

## Testing

```bash
npm run test      # Run all tests
npm run build     # Verify build
npm run lint      # Type check & linting
```

---

## Questions?

- **Issues**: Check [existing issues](https://github.com/refarm-dev/refarm/issues)
- **Discussions**: Start a [discussion thread](https://github.com/refarm-dev/refarm/discussions)
- **Security**: See [SECURITY.md](SECURITY.md) for reporting vulnerabilities

---

## License

By contributing to Refarm, you agree that your contributions will be licensed under the [AGPL-3.0 License](LICENSE).
