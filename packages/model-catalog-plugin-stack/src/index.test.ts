import { readFileSync } from "node:fs";
import type { ModelRateCatalog } from "../../model-catalog-v1/src/index.js";
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
  composeModelRateCatalog,
  MODEL_RATE_CATALOG_PLUGIN_CAPABILITY,
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

const shipped = JSON.parse(
	readFileSync(
		new URL("../../model-catalog-v1/catalog/model-rates.v1.json", import.meta.url),
		"utf8",
	),
) as ModelRateCatalog;

describe("the default plugin stack", () => {
	it("serves the audited catalog rather than restating it", () => {
		// Until 2026-08-04 the provider plugins carried their own entries, and they had drifted
		// into a second, wrong catalog: claude-opus at $8/$40, a figure the vendor lists for no
		// model at all, and gpt-5 at half its real output rate, both stamped with a verifiedAt
		// nobody had earned. This asserts there is one source, not two that agree today.
		const composed = composeModelRateCatalog({
			catalogVersion: "test",
			plugins: createDefaultModelRatePluginStack(),
		});
		const served = composed.entries.map((e) => `${e.provider}:${e.match.value}`);
		const expected = shipped.entries
			.filter((e) => e.provider === "openai" || e.provider === "anthropic")
			.map((e) => `${e.provider}:${e.match.value}`);
		expect(new Set(served)).toEqual(new Set(expected));
	});

	it("keeps every served rate identical to the audited one", () => {
		const composed = composeModelRateCatalog({
			catalogVersion: "test",
			plugins: createDefaultModelRatePluginStack(),
		});
		for (const entry of composed.entries) {
			const source = shipped.entries.find(
				(e) =>
					e.provider === entry.provider &&
					e.match.value === entry.match.value &&
					e.effectiveFrom === entry.effectiveFrom,
			);
			expect(source, `${entry.provider}:${entry.match.value} is not in the shipped catalog`).toBeDefined();
			expect(entry.rate).toEqual(source?.rate);
			expect(entry.verifiedAt).toBe(source?.verifiedAt);
		}
	});

	it("refuses a composition whose plugin order shadows a specific rule", () => {
		// Each plugin can be valid alone while the concatenation is not. A node adding a family
		// rule ahead of the defaults is the realistic case, and it would silently misprice every
		// model of that family instead of failing.
		const familyFirst = {
			id: "test:family-first",
			capability: MODEL_RATE_CATALOG_PLUGIN_CAPABILITY,
			entries: () => [
				{
					provider: "openai",
					match: { mode: "contains" as const, value: "gpt-5" },
					rate: { inputPerMTokenUsd: 1.25, outputPerMTokenUsd: 5 },
					pricingUrl: "https://developers.openai.com/api/docs/pricing",
					verifiedAt: "2026-08-04",
				},
			],
		};
		expect(() =>
			composeModelRateCatalog({
				catalogVersion: "test",
				plugins: [familyFirst, ...createDefaultModelRatePluginStack()],
			}),
		).toThrow(/can never be reached/);
	});
});
