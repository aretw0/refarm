import type { ModelRateEntry } from "../../model-catalog-v1/src/index.js";

export const MODEL_RATE_CATALOG_PLUGIN_CAPABILITY = "model-rate-catalog-plugin:v1" as const;
export const OPENAI_MODEL_RATE_PLUGIN_ID = "provider:openai" as const;

export interface ModelCatalogRatesPlugin {
  id: string;
  capability: typeof MODEL_RATE_CATALOG_PLUGIN_CAPABILITY;
  entries(): readonly ModelRateEntry[];
}

const OPENAI_ENTRIES: readonly ModelRateEntry[] = [
  {
    provider: "openai",
    match: { mode: "contains", value: "gpt-5" },
    rate: { inputPerMTokenUsd: 1.25, outputPerMTokenUsd: 5 },
    pricingUrl: "https://developers.openai.com/api/pricing/",
    verifiedAt: "2026-08-04",
  },
  {
    provider: "openai",
    match: { mode: "contains", value: "gpt-4.1" },
    rate: { inputPerMTokenUsd: 2, outputPerMTokenUsd: 8 },
    pricingUrl: "https://developers.openai.com/api/pricing/",
    verifiedAt: "2026-08-04",
  },
];

export function createOpenaiModelRatePlugin(): ModelCatalogRatesPlugin {
  return {
    id: OPENAI_MODEL_RATE_PLUGIN_ID,
    capability: MODEL_RATE_CATALOG_PLUGIN_CAPABILITY,
    entries: () => [...OPENAI_ENTRIES],
  };
}
