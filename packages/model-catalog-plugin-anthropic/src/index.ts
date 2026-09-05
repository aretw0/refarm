import { readFileSync } from "node:fs";

import type { ModelRateCatalog, ModelRateEntry } from "../../model-catalog-v1/src/index.js";

export const MODEL_RATE_CATALOG_PLUGIN_CAPABILITY = "model-rate-catalog-plugin:v1" as const;
export const ANTHROPIC_MODEL_RATE_PLUGIN_ID = "provider:anthropic" as const;

export interface ModelCatalogRatesPlugin {
  id: string;
  capability: typeof MODEL_RATE_CATALOG_PLUGIN_CAPABILITY;
  entries(): readonly ModelRateEntry[];
}

/**
 * This plugin SERVES the audited catalog; it does not restate it.
 *
 * It used to carry its own hand-written entries, and by 2026-08-04 they had drifted into a second,
 * wrong catalog: two coarse family rules per provider, priced at figures the vendor's page does not
 * list, each stamped with a verifiedAt nobody had earned. Under first-match-wins those family rules
 * would also have shadowed every specific model -- "gpt-5.6-sol" contains "gpt-5", so Sol would have
 * priced at a sixth of its real output rate.
 *
 * Nothing consumed the composed catalog yet, so no run was ever mispriced. That is luck, not design,
 * and the fix removes the second source rather than correcting it: the shipped
 * model-rates.v1.json is the artifact with provenance per fact, a shadowing guard, and a superset
 * test. A provider plugin's job is delivery -- which rows belong to it, in the audited order -- not
 * authorship.
 */
function shippedEntries(): readonly ModelRateEntry[] {
  const catalog = JSON.parse(
    readFileSync(
      new URL("../../model-catalog-v1/catalog/model-rates.v1.json", import.meta.url),
      "utf8",
    ),
  ) as ModelRateCatalog;
  return catalog.entries.filter((entry) => entry.provider === "anthropic");
}

export function createAnthropicModelRatePlugin(): ModelCatalogRatesPlugin {
  return {
    id: ANTHROPIC_MODEL_RATE_PLUGIN_ID,
    capability: MODEL_RATE_CATALOG_PLUGIN_CAPABILITY,
    entries: shippedEntries,
  };
}
