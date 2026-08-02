# Localization (i18n) Files

This directory contains translation files for Refarm in multiple languages.

## Supported Languages

- **en** — English — explicit fallback and public base
- **pt-BR** — Portuguese (Brazil) — selected for Brazilian operators
- **es** — Spanish

## File Structure

Each language has a corresponding JSON file with translation keys:

```
locales/
├── pt-BR.json    (Portuguese - Brazil)
├── en.json       (English)
├── es.json       (Spanish)
└── README.md     (This file)
```

## Adding Translations

### 1. Add Key to Base Language

Update all three locale files with the new key. Start with the English fallback:

```json
{
	"existing.key": "Value",
	"new.key": "New string"
}
```

### 2. Translate to Other Languages

Add the same key to `pt-BR.json` and `es.json`:

```json
{
	"new.key": "Nova string"
}
```

### 3. Verify Consistency

Run the validation script:

```bash
pnpm --filter @refarm.dev/homestead test -- l8n-host
```

This ensures no shipped language is missing an English fallback key.

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

Do not encode ICU syntax until a MessageFormat implementation is adopted. For now,
use separate semantic messages for singular and plural. This keeps unsupported syntax
from leaking into an operator surface.

```json
{
	"item.count.one": "{count} item",
	"item.count.other": "{count} items"
}
```

Usage in code:

```typescript
t(count === 1 ? "item.count.one" : "item.count.other", { count });
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
const date = new Intl.DateTimeFormat("pt-BR", {
	year: "numeric",
	month: "long",
	day: "numeric",
}).format(new Date());

const price = new Intl.NumberFormat("pt-BR", {
	style: "currency",
	currency: "BRL",
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
2. Run the verification command above
3. Add it to `REFARM_SUPPORTED_LOCALES` in `@refarm.dev/localization-v1`.
4. Run the localization and Homestead tests.

## Resources

- [ICU MessageFormat](https://unicode-org.github.io/icu/userguide/format_parse/messages/)
- [Intl API](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl)
- [astro-i18next Guide](https://astro-i18next.pages.dev/)
- [CLDR Locale Data](http://cldr.unicode.org/)

---

**Last Updated**: August 2026
