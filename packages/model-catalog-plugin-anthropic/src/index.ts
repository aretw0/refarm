import type { ModelRateEntry } from "../../model-catalog-v1/src/index.js";

export const MODEL_RATE_CATALOG_PLUGIN_CAPABILITY = "model-rate-catalog-plugin:v1" as const;
export const ANTHROPIC_MODEL_RATE_PLUGIN_ID = "provider:anthropic" as const;

export interface ModelCatalogRatesPlugin {
  id: string;
  capability: typeof MODEL_RATE_CATALOG_PLUGIN_CAPABILITY;
  entries(): readonly ModelRateEntry[];
}

const ANTHROPIC_ENTRIES: readonly ModelRateEntry[] = [
  {
    provider: "anthropic",
    match: { mode: "contains", value: "claude-sonnet" },
    rate: { inputPerMTokenUsd: 2, outputPerMTokenUsd: 10 },
    pricingUrl: "https://docs.anthropic.com/en/docs/about-claude/pricing",
    verifiedAt: "2026-08-04",
  },
  {
    provider: "anthropic",
    match: { mode: "contains", value: "claude-opus" },
    rate: { inputPerMTokenUsd: 8, outputPerMTokenUsd: 40 },
    pricingUrl: "https://docs.anthropic.com/en/docs/about-claude/pricing",
    verifiedAt: "2026-08-04",
  },
];

export function createAnthropicModelRatePlugin(): ModelCatalogRatesPlugin {
  return {
    id: ANTHROPIC_MODEL_RATE_PLUGIN_ID,
    capability: MODEL_RATE_CATALOG_PLUGIN_CAPABILITY,
    entries: () => [...ANTHROPIC_ENTRIES],
  };
}
