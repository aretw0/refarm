import type {
  ModelTariffCatalog,
  ModelTariffEntry,
  ModelRateCatalog,
} from "../../model-catalog-v1/src/index.js";
import { createAnthropicModelRatePlugin } from "../../model-catalog-plugin-anthropic/src/index.js";
import { createOpenaiModelRatePlugin } from "../../model-catalog-plugin-openai/src/index.js";

export const MODEL_RATE_CATALOG_PLUGIN_CAPABILITY = "model-rate-catalog-plugin:v1" as const;
export const MODEL_RATE_CATALOG_COMPOSER_CAPABILITY = "model-rate-catalog-composer:v1" as const;
export const MODEL_TARIFF_CATALOG_PLUGIN_CAPABILITY = MODEL_RATE_CATALOG_PLUGIN_CAPABILITY;
export const MODEL_TARIFF_CATALOG_COMPOSER_CAPABILITY = MODEL_RATE_CATALOG_COMPOSER_CAPABILITY;

export interface ModelCatalogTariffPlugin {
  id: string;
  capability: typeof MODEL_TARIFF_CATALOG_PLUGIN_CAPABILITY;
  entries(): readonly ModelTariffEntry[];
}

export type ModelCatalogRatesPlugin = ModelCatalogTariffPlugin;

export interface ComposeModelTariffCatalogInput {
  catalogVersion: string;
  plugins: readonly ModelCatalogTariffPlugin[];
}

export type ComposeModelCatalogInput = ComposeModelTariffCatalogInput;

export interface ModelCatalogTariffComposerPlugin {
  id: string;
  capability: typeof MODEL_TARIFF_CATALOG_COMPOSER_CAPABILITY;
  compose(input: ComposeModelTariffCatalogInput): ModelTariffCatalog;
}

export interface ModelCatalogComposerPlugin {
  id: string;
  capability: typeof MODEL_RATE_CATALOG_COMPOSER_CAPABILITY;
  compose(input: ComposeModelCatalogInput): ModelRateCatalog;
}

export function composeModelTariffCatalog(input: ComposeModelTariffCatalogInput): ModelTariffCatalog {
  const entries: ModelTariffEntry[] = [];
  for (const plugin of input.plugins) {
    entries.push(...plugin.entries());
  }

  return {
    schemaVersion: "model-tariff-catalog.v1",
    catalogVersion: input.catalogVersion,
    entries,
  };
}

export function composeModelRateCatalog(input: ComposeModelCatalogInput): ModelRateCatalog {
  const tariffCatalog = composeModelTariffCatalog(input);

  return {
    schemaVersion: "model-rate-catalog.v1",
    catalogVersion: tariffCatalog.catalogVersion,
    entries: tariffCatalog.entries,
  };
}

export function createDefaultModelTariffPluginStack(): readonly ModelCatalogTariffPlugin[] {
  return [createOpenaiModelRatePlugin(), createAnthropicModelRatePlugin()];
}

export function createDefaultModelRatePluginStack(): readonly ModelCatalogRatesPlugin[] {
  return createDefaultModelTariffPluginStack();
}

export function createDefaultModelTariffCatalog(catalogVersion = "local"): ModelTariffCatalog {
  return composeModelTariffCatalog({
    catalogVersion,
    plugins: createDefaultModelTariffPluginStack(),
  });
}

export function createDefaultModelRateCatalog(catalogVersion = "local"): ModelRateCatalog {
  const tariffCatalog = createDefaultModelTariffCatalog(catalogVersion);
  return {
    schemaVersion: "model-rate-catalog.v1",
    catalogVersion: tariffCatalog.catalogVersion,
    entries: tariffCatalog.entries,
  };
}

export function createModelTariffComposerPlugin(): ModelCatalogTariffComposerPlugin {
  return {
    id: "composer:model-catalog-stack",
    capability: MODEL_TARIFF_CATALOG_COMPOSER_CAPABILITY,
    compose: composeModelTariffCatalog,
  };
}

export function createModelRateComposerPlugin(): ModelCatalogComposerPlugin {
  return {
    id: "composer:model-catalog-stack",
    capability: MODEL_RATE_CATALOG_COMPOSER_CAPABILITY,
    compose: composeModelRateCatalog,
  };
}
