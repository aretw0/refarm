import { createAnthropicModelRatePlugin } from "../../model-catalog-plugin-anthropic/src/index.js";
import { createOpenaiModelRatePlugin } from "../../model-catalog-plugin-openai/src/index.js";
import {
	assertValidModelRateCatalog,
	type ModelRateCatalog,
	type ModelTariffCatalog,
	type ModelTariffEntry,
} from "../../model-catalog-v1/src/index.js";

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

/**
 * Composition CONCATENATES plugin entries in plugin order, and resolution is first-match-wins, so
 * plugin order is precedence: a node's own plugin placed first overrides the defaults, which is the
 * intended way to correct a rate without a build.
 *
 * That same property is why the result is validated rather than merely built. Each plugin can be
 * valid on its own while the concatenation is not: a later plugin's specific rule becomes
 * unreachable behind an earlier plugin's family rule, and the catalog answers with a plausible
 * wrong price instead of failing. The guard on the shipped file protected the file; this protects
 * the catalog that is actually used.
 */
export function composeModelRateCatalog(input: ComposeModelCatalogInput): ModelRateCatalog {
  const tariffCatalog = composeModelTariffCatalog(input);

  const composed: ModelRateCatalog = {
    schemaVersion: "model-rate-catalog.v1",
    catalogVersion: tariffCatalog.catalogVersion,
    entries: tariffCatalog.entries,
  };
  assertValidModelRateCatalog(composed);
  return composed;
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
