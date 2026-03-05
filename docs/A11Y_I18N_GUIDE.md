# Accessibility (a11y) & Internationalization (i18n) Implementation Guide

**Status**: Phase 1 Setup (Português BR, English, Español)  
**Updated**: March 2026

---

## Quick Start

### 1. Acessibilidade (a11y)

#### Setup (@axe-core)

```bash
npm install --save-dev @axe-core/playwright eslint-plugin-jsx-a11y

# Update package.json scripts
npm run build        # Includes a11y checks
npm run test:a11y    # Run accessibility tests
```

#### Daily Practice

When writing HTML/components:

```typescript
// ✅ GOOD: Use semantic elements
<nav aria-label="Main navigation">
  <a href="/">Home</a>
</nav>

<main role="main">
  <h1>Page Title</h1>
</main>

// ✅ Use ARIA for custom components
<div role="button" 
     tabindex="0" 
     aria-pressed="false"
     @click=${this.toggle}>
  Toggle
</div>

// ❌ AVOID: Generic divs for interactive content
<div @click=${this.toggle}>Toggle</div>
```

**Focus Management**:

```typescript
// Always show focus indicator
button:focus {
  outline: 2px solid #0066ff;
  outline-offset: 2px;
}

// Set focus on dialog open
openDialog() {
  this.dialogOpen = true;
  this.requestUpdate();
  this.requestUpdateComplete.then(() => {
    this.closeButton?.focus();
  });
}
```

**Keyboard Navigation**:

```typescript
// Support Escape key for modals
@hostListener('keydown', ['$event'])
handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape' && this.open) {
    this.close();
  }
}
```

---

### 2. Internacionalização (i18n)

#### Setup (astro-i18next)

```bash
npm install astro-i18next astro-i18next-loader
npm install --save-dev @lit/localize
```

#### Configuration

**astro.config.mjs**:

```javascript
import { defineConfig } from "astro/config";
import astroI18next from "astro-i18next";

export default defineConfig({
  integrations: [astroI18next()],
  i18n: {
    defaultLocale: "pt-BR",
    locales: ["pt-BR", "en", "es"],
    routing: {
      prefixDefaultLocale: false  // /en/... not /pt-BR/...
    }
  }
});
```

#### Adding Translations

Create locale files:

```
locales/
├── pt-BR.json
├── en.json
└── es.json
```

**locales/pt-BR.json**:

```json
{
  "nav.home": "Início",
  "nav.plugins": "Plugins",
  "nav.docs": "Documentação",
  "studio.welcome": "Bem-vindo ao Refarm Studio",
  "studio.plugins": {
    "title": "Meus Plugins",
    "empty": "Nenhum plugin instalado",
    "count": "{count, plural, one {# plugin} other {# plugins}}"
  },
  "action.save": "Salvar",
  "action.delete": "Deletar",
  "error.network": "Erro de conexão. Tente novamente."
}
```

**locales/en.json**:

```json
{
  "nav.home": "Home",
  "nav.plugins": "Plugins",
  "nav.docs": "Documentation",
  "studio.welcome": "Welcome to Refarm Studio",
  "studio.plugins": {
    "title": "My Plugins",
    "empty": "No plugins installed",
    "count": "{count, plural, one {# plugin} other {# plugins}}"
  },
  "action.save": "Save",
  "action.delete": "Delete",
  "error.network": "Connection error. Please try again."
}
```

#### Using in Astro Components

```astro
---
import { useTranslation } from "astro-i18next";

const { t } = useTranslation();
---

<nav>
  <a href="/">{t("nav.home")}</a>
  <a href="/plugins">{t("nav.plugins")}</a>
  <a href="/docs">{t("nav.docs")}</a>
</nav>

<h1>{t("studio.welcome")}</h1>
```

#### Using in Web Components (Lit)

```typescript
import { LitElement, html } from "lit";
import { msg, localized, str } from "@lit/localize";

@localized()
@customElement("studio-header")
export class StudioHeader extends LitElement {
  render() {
    return html`
      <h1>${msg("Welcome to Refarm Studio")}</h1>
      <p>${msg(str`You have ${this.pluginCount} plugins configured`)}</p>
    `;
  }
}
```

---

## Standards & Guidelines

### WCAG 2.2 Level AA (Accessibility)

| Criterion | Requirement | Example |
|-----------|-------------|---------|
| **Contrast** | 4.5:1 for text | `#000` on `#fff` = 21:1 ✅ |
| **Keyboard** | All functions keyboard accessible | Click → Always has Tab/Enter alternative |
| **Labels** | Form inputs have associated labels | `<label for="email">` + `<input id="email">` |
| **Focus** | Visible focus indicator | `outline: 2px solid;` |
| **Semantics** | Use native HTML elements | `<button>` not `<div role="button">` |
| **ARIA** | Use ARIA when semantic HTML insufficient | `aria-label`, `aria-describedby`, `role` |

### ICU MessageFormat 2.0 (Internationalization)

**Syntax for complex strings**:

```json
{
  "items": "{count, plural, one {# item} other {# items}}",
  "welcome": "Welcome, {name}!",
  "date": "{date, date, medium}",
  "price": "{amount, number, :: currency/BRL}"
}
```

**Usage**:

```typescript
t("items", { count: 5 })           // "5 items"
t("welcome", { name: "Alice" })    // "Welcome, Alice!"
t("price", { amount: 99.99 })      // "R$ 99,99"
```

---

## Implementation Checklist

### Pre-Development

- [ ] Locale files created (pt-BR, en, es)
- [ ] astro-i18next configured
- [ ] @lit/localize installed (for Web Components)
- [ ] axe-core tests configured

### During Development

- [ ] **Every new page/component**:
  - [ ] All user-facing text uses `t()` function
  - [ ] ARIA labels added for interactive elements
  - [ ] Semantic HTML used (nav, main, article, button, etc.)
  - [ ] Focus styles visible
  - [ ] Keyboard navigation works (Tab, Enter, Escape)

### Before Pull Request

- [ ] Run `npm run build` (includes a11y checks)
- [ ] Run `npm run test:a11y` green for changed components
- [ ] Check translations in all 3 locales
- [ ] Test keyboard navigation manually
- [ ] Test with screen reader (manual, 1 UI section minimum)

### Checklist Template for PR Description

```markdown
## Accessibility & i18n

- [ ] All text strings use translation keys (not hardcoded)
- [ ] ARIA labels added where needed (role, aria-label, etc.)
- [ ] Keyboard navigation tested (Tab, Enter, Escape)
- [ ] Focus indicators visible
- [ ] Color contrast ≥ 4.5:1
- [ ] Translations verified for pt-BR, en, es
- [ ] New locale keys documented
- [ ] Axe accessibility checks pass
```

---

## Common Patterns

### Modal Dialog

```typescript
@customElement("refarm-modal")
export class Modal extends LitElement {
  @property() open = false;
  @property() title = "";

  private closeButton?: HTMLButtonElement;

  updated(changed: PropertyValues) {
    if (changed.has("open") && this.open) {
      // Focus management on open
      this.requestUpdateComplete.then(() => {
        this.closeButton?.focus();
      });
    }
  }

  @hostListener("keydown.escape")
  onEscape() {
    this.open = false;
  }

  render() {
    return html`
      <dialog ?open=${this.open} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h1 id="dialog-title">${this.title}</h1>
        <slot></slot>
        <button 
          #closeButton
          @click=${() => (this.open = false)}
          aria-label="Close dialog">
          ×
        </button>
      </dialog>
    `;
  }
}
```

### Localized Number/Date

```typescript
import { msg, localized } from "@lit/localize";

@localized()
@customElement("date-display")
export class DateDisplay extends LitElement {
  @property() date = new Date();

  render() {
    const formatted = new Intl.DateTimeFormat(navigator.language, {
      year: "numeric",
      month: "long",
      day: "numeric"
    }).format(this.date);

    return html`<time datetime=${this.date.toISOString()}>${formatted}</time>`;
  }
}
```

---

## Testing

### Automated a11y Testing

```typescript
// test/accessibility.spec.ts
import { test, expect } from '@playwright/test';
import { injectAxe, checkA11y } from 'axe-playwright';

test('studio homepage passes axe checks', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await injectAxe(page);
  await checkA11y(page, null, { detailedReport: true });
});
```

### Manual i18n Verification

```bash
# Check all keys are defined
grep -r "t(" src/ | grep -oE "\"[^\"]+\"" | sort -u > used-keys.txt
jq 'keys' locales/pt-BR.json | sort -u > defined-keys.txt

# Should be minimal differences
diff used-keys.txt defined-keys.txt
```

---

## Resources

### Accessibility

- [WebAIM: Getting Started with WCAG 2.2](https://webaim.org/articles/wcag2/)
- [MDN: ARIA](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA)
- [Axe DevTools](https://www.deque.com/axe/devtools/)
- [Color Contrast Checker](https://webaim.org/resources/contrastchecker/)

### Internationalization

- [astro-i18next Docs](https://astro-i18next.pages.dev/)
- [@lit/localize Guide](https://lit.dev/docs/localization/overview/)
- [Unicode CLDR](http://cldr.unicode.org/)
- [ICU MessageFormat Reference](https://unicode-org.github.io/icu/userguide/format_parse/messages/)

---

**Maintained by**: Refarm Team  
**Last Updated**: March 2026
