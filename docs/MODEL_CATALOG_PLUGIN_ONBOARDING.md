# Model-catalog Plugin Onboarding

This guide turns the model-catalog plugin family into an operational path the team can run today.

## Scope

Packages in this lane:

- `@refarm.dev/model-catalog-plugin-openai`
- `@refarm.dev/model-catalog-plugin-anthropic`
- `@refarm.dev/model-catalog-plugin-stack`

Versioning intent for this lane:

- Keep the family aligned in the `0.1.x` line while behavior and contracts stabilize.
- Track baseline release intent through `.changeset/model-catalog-plugin-initial-release.md`.

## Day-0 onboarding checklist

Run from repository root:

```bash
pnpm install
pnpm run onboarding:doctor
pnpm run onboarding:doctor -- --package packages/model-catalog-plugin-openai
pnpm run onboarding:doctor -- --package packages/model-catalog-plugin-anthropic
pnpm run onboarding:doctor -- --package packages/model-catalog-plugin-stack
pnpm --filter "@refarm.dev/model-catalog-plugin-*" test
pnpm run models:catalog:check
```

Expected outcome:

- Onboarding doctor reports substrate and `tsconfig` healthy.
- Plugin tests pass for provider and composer plugins.
- Catalog guard (`models:catalog:check`) passes with no overlap/shape violations.

## How to use now (application side)

Current usage options:

1. Provider-only import

```ts
import { createOpenaiModelRatePlugin } from "@refarm.dev/model-catalog-plugin-openai";
import { createAnthropicModelRatePlugin } from "@refarm.dev/model-catalog-plugin-anthropic";
```

2. Composed catalog import

```ts
import {
  createDefaultModelRateCatalog,
  createDefaultModelRatePluginStack,
  composeModelRateCatalog,
} from "@refarm.dev/model-catalog-plugin-stack";

const defaultCatalog = createDefaultModelRateCatalog("local");

const customCatalog = composeModelRateCatalog({
  catalogVersion: "local-custom",
  plugins: createDefaultModelRatePluginStack(),
});
```

## Adoption plan (facilitate everyone)

### Phase 1: Immediate consumer path (now)

- Keep existing static catalog behavior as fallback.
- Add a runtime flag or loader seam that allows sourcing catalog entries from plugin stack composition.
- Validate with `pnpm run models:catalog:check` in CI for any generated/merged catalog.

### Phase 2: Team default path (next)

- Promote plugin-stack composition to default source for model-rate catalog generation.
- Keep provider plugins as independent ownership surfaces so updates stay small and reviewable.
- Gate provider PRs with targeted tests:

```bash
pnpm --filter @refarm.dev/model-catalog-plugin-openai test
pnpm --filter @refarm.dev/model-catalog-plugin-anthropic test
pnpm --filter @refarm.dev/model-catalog-plugin-stack test
```

### Phase 3: Governance and release hygiene

- Keep changesets for this family consolidated when possible.
- Review pricing `verifiedAt` and `pricingUrl` freshness as part of release checklist.
- Keep overlap checks as hard-fail policy before publish.

## PR checklist for plugin updates

- [ ] Provider/composer tests pass.
- [ ] `models:catalog:check` passes.
- [ ] Onboarding doctor passes for touched package(s).
- [ ] Changeset updated when behavior/version intent changed.
- [ ] `verifiedAt` values reviewed for touched entries.
