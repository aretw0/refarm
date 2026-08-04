import { describe, expect, it } from "vitest";
import {
  assertValidModelTariffCatalog,
  resolveModelTariff,
  assertValidModelRateCatalog,
  resolveModelRate,
  type ModelTariffCatalog,
  type ModelRateCatalog,
} from "./index.js";

const fixture: ModelRateCatalog = {
  schemaVersion: "model-rate-catalog.v1",
  catalogVersion: "2026-08-04.0",
  entries: [
    {
      provider: "anthropic",
      match: { mode: "contains", value: "claude-sonnet-5" },
      rate: { inputPerMTokenUsd: 2, outputPerMTokenUsd: 10 },
      effectiveFrom: "2026-06-01",
      effectiveTo: "2026-08-31",
      pricingUrl: "https://platform.claude.com/docs/en/about-claude/pricing",
      verifiedAt: "2026-08-04",
    },
    {
      provider: "anthropic",
      match: { mode: "contains", value: "claude-sonnet-5" },
      rate: { inputPerMTokenUsd: 3, outputPerMTokenUsd: 15 },
      effectiveFrom: "2026-09-01",
      pricingUrl: "https://platform.claude.com/docs/en/about-claude/pricing",
      verifiedAt: "2026-08-04",
    },
    {
      provider: "openai",
      match: { mode: "contains", value: "gpt-5.6-sol" },
      rate: { inputPerMTokenUsd: 5, outputPerMTokenUsd: 30 },
      pricingUrl: "https://developers.openai.com/api/docs/pricing",
      verifiedAt: "2026-08-04",
    },
  ],
};

const tariffFixture: ModelTariffCatalog = {
  ...fixture,
  schemaVersion: "model-tariff-catalog.v1",
};

describe("model-catalog-v1", () => {
  it("validates the fixture catalog", () => {
    expect(() => assertValidModelRateCatalog(fixture)).not.toThrow();
  });

  it("resolves date-sensitive pricing windows", () => {
    const before = resolveModelRate(fixture, {
      provider: "anthropic",
      modelId: "claude-sonnet-5",
      at: "2026-08-15",
    });

    const after = resolveModelRate(fixture, {
      provider: "anthropic",
      modelId: "claude-sonnet-5",
      at: "2026-09-02",
    });

    expect(before?.rate).toEqual({ inputPerMTokenUsd: 2, outputPerMTokenUsd: 10 });
    expect(after?.rate).toEqual({ inputPerMTokenUsd: 3, outputPerMTokenUsd: 15 });
  });

  it("filters by provider and match rule", () => {
    const resolved = resolveModelRate(fixture, {
      provider: "openai",
      modelId: "gpt-5.6-sol",
      at: "2026-08-04",
    });

    expect(resolved?.rate).toEqual({ inputPerMTokenUsd: 5, outputPerMTokenUsd: 30 });
  });

  it("returns undefined when no entry matches", () => {
    const resolved = resolveModelRate(fixture, {
      provider: "together",
      modelId: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      at: "2026-08-04",
    });

    expect(resolved).toBeUndefined();
  });

  it("validates tariff-first schema and resolves tariff aliases", () => {
    expect(() => assertValidModelTariffCatalog(tariffFixture)).not.toThrow();

    const resolved = resolveModelTariff(tariffFixture, {
      provider: "openai",
      modelId: "gpt-5.6-sol",
      at: "2026-08-04",
    });

    expect(resolved?.tariff).toEqual({ inputPerMTokenUsd: 5, outputPerMTokenUsd: 30 });
  });
});

describe("contextWindow provenance", () => {
  const withWindow = (contextWindow: unknown): unknown => ({
    schemaVersion: "model-rate-catalog.v1",
    catalogVersion: "2026-08-04.1",
    entries: [
      {
        provider: "xai",
        match: { mode: "contains", value: "grok-4.3" },
        rate: { inputPerMTokenUsd: 1, outputPerMTokenUsd: 2 },
        pricingUrl: "https://docs.x.ai/docs/models",
        verifiedAt: "2026-08-04",
        contextWindow,
      },
    ],
  });

  it("accepts a window that names its own source and date", () => {
    expect(() =>
      assertValidModelRateCatalog(
        withWindow({
          tokens: 1_000_000,
          sourceUrl: "https://docs.x.ai/docs/models",
          verifiedAt: "2026-08-04",
        }),
      ),
    ).not.toThrow();
  });

  it("stays absent without complaint when the vendor publishes no figure", () => {
    // gemini-3-flash-preview and mistral-medium-3-5 are exactly this case in the real
    // catalog: their overview pages carry no context-window figure, so they carry no
    // entry. Absent must remain cheaper than guessing.
    const noWindow = withWindow(undefined) as { entries: Array<Record<string, unknown>> };
    delete noWindow.entries[0].contextWindow;
    expect(() => assertValidModelRateCatalog(noWindow)).not.toThrow();
  });

  it("rejects a window that borrows the entry's citation instead of carrying its own", () => {
    // The failure this field exists to prevent: a number present, a source missing, and
    // the reader assuming the neighbouring pricingUrl covers it.
    expect(() => assertValidModelRateCatalog(withWindow({ tokens: 1_000_000 }))).toThrow(
      /contextWindow\.sourceUrl/,
    );
    expect(() =>
      assertValidModelRateCatalog(
        withWindow({ tokens: 1_000_000, sourceUrl: "https://docs.x.ai/docs/models" }),
      ),
    ).toThrow(/contextWindow\.verifiedAt/);
  });

  it("rejects a window that is not a positive whole number of tokens", () => {
    for (const tokens of [0, -1, 1.5, "1000000"]) {
      expect(() =>
        assertValidModelRateCatalog(
          withWindow({
            tokens,
            sourceUrl: "https://docs.x.ai/docs/models",
            verifiedAt: "2026-08-04",
          }),
        ),
      ).toThrow(/contextWindow\.tokens/);
    }
  });
});
