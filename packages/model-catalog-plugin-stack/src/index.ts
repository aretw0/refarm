import type { ModelRateCatalog, ModelRateEntry } from "../../model-catalog-v1/src/index.js";
import { createAnthropicModelRatePlugin } from "../../model-catalog-plugin-anthropic/src/index.js";
import { createOpenaiModelRatePlugin } from "../../model-catalog-plugin-openai/src/index.js";

export const MODEL_RATE_CATALOG_PLUGIN_CAPABILITY = "model-rate-catalog-plugin:v1" as const;
export const MODEL_RATE_CATALOG_COMPOSER_CAPABILITY = "model-rate-catalog-composer:v1" as const;

export interface ModelCatalogRatesPlugin {
  id: string;
  capability: typeof MODEL_RATE_CATALOG_PLUGIN_CAPABILITY;
  entries(): readonly ModelRateEntry[];
}

export interface ComposeModelCatalogInput {
  catalogVersion: string;
  plugins: readonly ModelCatalogRatesPlugin[];
}

export interface ModelCatalogComposerPlugin {
  id: string;
  capability: typeof MODEL_RATE_CATALOG_COMPOSER_CAPABILITY;
  compose(input: ComposeModelCatalogInput): ModelRateCatalog;
}

export function composeModelRateCatalog(input: ComposeModelCatalogInput): ModelRateCatalog {
  const entries: ModelRateEntry[] = [];
  for (const plugin of input.plugins) {
    entries.push(...plugin.entries());
  }

  return {
    schemaVersion: "model-rate-catalog.v1",
    catalogVersion: input.catalogVersion,
    entries,
  };
}

export function createDefaultModelRatePluginStack(): readonly ModelCatalogRatesPlugin[] {
  return [createOpenaiModelRatePlugin(), createAnthropicModelRatePlugin()];
}

export function createDefaultModelRateCatalog(catalogVersion = "local"): ModelRateCatalog {
  return composeModelRateCatalog({
    catalogVersion,
    plugins: createDefaultModelRatePluginStack(),
  });
}

export function createModelRateComposerPlugin(): ModelCatalogComposerPlugin {
  return {
    id: "composer:model-catalog-stack",
    capability: MODEL_RATE_CATALOG_COMPOSER_CAPABILITY,
    compose: composeModelRateCatalog,
  };
}
