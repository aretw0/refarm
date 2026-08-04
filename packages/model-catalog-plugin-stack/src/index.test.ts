import { describe, expect, it } from "vitest";
import { resolveModelTariff, resolveModelRate } from "../../model-catalog-v1/src/index.js";
import {
  createDefaultModelTariffCatalog,
  createDefaultModelTariffPluginStack,
  createModelTariffComposerPlugin,
  MODEL_TARIFF_CATALOG_COMPOSER_CAPABILITY,
  createDefaultModelRateCatalog,
  createDefaultModelRatePluginStack,
  createModelRateComposerPlugin,
  MODEL_RATE_CATALOG_COMPOSER_CAPABILITY,
} from "./index.js";

describe("model-catalog-plugin-stack", () => {
  it("composes two provider plugins into one tariff catalog", () => {
    const catalog = createDefaultModelTariffCatalog("2026-08-04.stack.tariff.1");
    expect(catalog.schemaVersion).toBe("model-tariff-catalog.v1");
    expect(catalog.entries.length).toBeGreaterThanOrEqual(4);
  });

  it("composes two provider plugins into one catalog", () => {
    const catalog = createDefaultModelRateCatalog("2026-08-04.stack.1");
    expect(catalog.schemaVersion).toBe("model-rate-catalog.v1");
    expect(catalog.entries.length).toBeGreaterThanOrEqual(4);
  });

  it("resolves tariffs from different providers after composition", () => {
    const catalog = createDefaultModelTariffCatalog("2026-08-04.stack.tariff.2");

    const openaiTariff = resolveModelTariff(catalog, {
      provider: "openai",
      modelId: "gpt-5",
      at: "2026-08-04",
    });

    const anthropicTariff = resolveModelTariff(catalog, {
      provider: "anthropic",
      modelId: "claude-sonnet-5",
      at: "2026-08-04",
    });

    expect(openaiTariff?.entry.provider).toBe("openai");
    expect(anthropicTariff?.entry.provider).toBe("anthropic");
  });

  it("resolves rates from different providers after composition", () => {
    const catalog = createDefaultModelRateCatalog("2026-08-04.stack.2");

    const openaiRate = resolveModelRate(catalog, {
      provider: "openai",
      modelId: "gpt-5",
      at: "2026-08-04",
    });

    const anthropicRate = resolveModelRate(catalog, {
      provider: "anthropic",
      modelId: "claude-sonnet-5",
      at: "2026-08-04",
    });

    expect(openaiRate?.entry.provider).toBe("openai");
    expect(anthropicRate?.entry.provider).toBe("anthropic");
  });

  it("exposes plugin-of-plugin composer capability", () => {
    const stack = createDefaultModelRatePluginStack();
    const composer = createModelRateComposerPlugin();
    const catalog = composer.compose({
      catalogVersion: "2026-08-04.stack.3",
      plugins: stack,
    });

    expect(composer.capability).toBe(MODEL_RATE_CATALOG_COMPOSER_CAPABILITY);
    expect(catalog.catalogVersion).toBe("2026-08-04.stack.3");
  });

  it("exposes tariff plugin-of-plugin composer capability", () => {
    const stack = createDefaultModelTariffPluginStack();
    const composer = createModelTariffComposerPlugin();
    const catalog = composer.compose({
      catalogVersion: "2026-08-04.stack.tariff.3",
      plugins: stack,
    });

    expect(composer.capability).toBe(MODEL_TARIFF_CATALOG_COMPOSER_CAPABILITY);
    expect(catalog.catalogVersion).toBe("2026-08-04.stack.tariff.3");
  });
});
