# Localization (i18n) Files

This directory contains translation files for Refarm in multiple languages.

## Supported Languages

- **pt-BR** — Portuguese (Brazil) — Default
- **en** — English
- **es** — Spanish

## File Structure

Each language has a corresponding JSON file with translation keys:

```
locales/
├── pt-BR.json    (Portuguese - Portugal)
├── en.json       (English)
├── es.json       (Spanish)
└── README.md     (This file)
```

## Adding Translations

### 1. Add Key to Base Language

Update all three locale files with the new key. Start with `pt-BR.json`:

```json
{
  "existing.key": "Value",
  "new.key": "Nova string"
}
```

### 2. Translate to Other Languages

Add the same key to `en.json` and `es.json`:

```json
{
  "new.key": "New string"
}
```

### 3. Verify Consistency

Run the validation script:

```bash
npm run i18n:check
```

This ensures all languages have the same keys (no missing or extra translations).

## Key Naming Conventions

- Use **hierarchical naming**: `section.subsection.key`
- Keep keys **lowercase** with **dots** as separators
- Use **descriptive names**: `action.save` not `btn123`
- Group related keys together

### Examples

```json
{
  "nav.home": "Início",
  "nav.plugins": "Plugins",
  "nav.docs": "Documentação",
  "studio.welcome": "Bem-vindo",
  "studio.plugins.title": "Meus Plugins",
  "action.save": "Salvar",
  "action.delete": "Deletar",
  "error.network": "Erro de conexão"
}
```

## Plural Handling

Use ICU MessageFormat for plurals:

```json
{
  "item.count": "{count, plural, one {# item} other {# items}}"
}
```

Usage in code:

```typescript
t("item.count", { count: 5 })  // "5 items"
t("item.count", { count: 1 })  // "1 item"
```

## Date/Number Formatting

For dates and numbers, use `Intl` API in code. Define descriptive keys:

```json
{
  "date.format": "Date format will be handled by Intl API",
  "number.currency": "Currency format will be handled by Intl API"
}
```

Code example:

```typescript
const date = new Intl.DateTimeFormat('pt-BR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric'
}).format(new Date());

const price = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL'
}).format(123.45);
```

## Translation Best Practices

✅ **DO:**

- Keep strings concise (plan for expansion)
- Provide context comments for translators
- Use variables for dynamic content: `{name}`, `{count}`
- Use consistent terminology

❌ **DON'T:**

- Hardcode text in components (always use keys)
- Use ambiguous key names
- Create culture-specific humor
- Assume text length (English is often shorter)

## Adding a New Language

If adding a new language (e.g., `fr` for French):

1. Create `fr.json` with all existing keys
2. Run `npm run i18n:check` to verify
3. Update `astro.config.mjs`:

   ```javascript
   i18n: {
     locales: ["pt-BR", "en", "es", "fr"],
     // ...
   }
   ```

## Resources

- [ICU MessageFormat](https://unicode-org.github.io/icu/userguide/format_parse/messages/)
- [Intl API](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl)
- [astro-i18next Guide](https://astro-i18next.pages.dev/)
- [CLDR Locale Data](http://cldr.unicode.org/)

---

**Last Updated**: March 2026
