import { readFileSync } from "node:fs";
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

  it("stays absent without complaint when there is no verified figure", () => {
    const noWindow = withWindow(undefined) as { entries: Array<Record<string, unknown>> };
    delete noWindow.entries[0].contextWindow;
    expect(() => assertValidModelRateCatalog(noWindow)).not.toThrow();
  });

  it("lets absence carry its reason, and tells the two reasons apart", () => {
    // The distinction that matters: "the vendor publishes nothing" is a fact about the
    // vendor; "we could not reach the page" is a fact about our own checking, and only
    // the second is somebody's next task. Recording the first for the second closes a
    // question that was never actually answered.
    for (const reason of ["not-published", "source-not-found"]) {
      const gap = withWindow(undefined) as { entries: Array<Record<string, unknown>> };
      delete gap.entries[0].contextWindow;
      gap.entries[0].contextWindowUnknown = { reason, checkedAt: "2026-08-04" };
      expect(() => assertValidModelRateCatalog(gap)).not.toThrow();
    }
  });

  it("rejects an unexplained or undated gap, and any reason outside the two", () => {
    const gapWith = (contextWindowUnknown: unknown): unknown => {
      const c = withWindow(undefined) as { entries: Array<Record<string, unknown>> };
      delete c.entries[0].contextWindow;
      c.entries[0].contextWindowUnknown = contextWindowUnknown;
      return c;
    };
    expect(() => assertValidModelRateCatalog(gapWith({ checkedAt: "2026-08-04" }))).toThrow(
      /contextWindowUnknown\.reason/,
    );
    expect(() => assertValidModelRateCatalog(gapWith({ reason: "not-published" }))).toThrow(
      /contextWindowUnknown\.checkedAt/,
    );
    expect(() =>
      assertValidModelRateCatalog(gapWith({ reason: "dunno", checkedAt: "2026-08-04" })),
    ).toThrow(/contextWindowUnknown\.reason/);
  });

  it("refuses a figure and a reason-for-no-figure at the same time", () => {
    const both = withWindow({
      tokens: 1_000_000,
      sourceUrl: "https://docs.x.ai/docs/models",
      verifiedAt: "2026-08-04",
    }) as { entries: Array<Record<string, unknown>> };
    both.entries[0].contextWindowUnknown = {
      reason: "source-not-found",
      checkedAt: "2026-08-04",
    };
    expect(() => assertValidModelRateCatalog(both)).toThrow(/contextWindowUnknown/);
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

describe("the shipped catalog", () => {
  // The package validator and scripts/ci/check-model-catalog.mjs are TWO checkers for one file,
  // and each has holes the other covers: the script validates date parseability, effective-window
  // ordering and same-value overlap; the validator owns contextWindow provenance and shadowing.
  // The script cannot import this package without adding a build-order dependency to CI, so the
  // seam stays — but it stops being silent: this test runs the validator against the real file,
  // so anything the validator knows is enforced on the shipped data too.
  const shipped = JSON.parse(
    readFileSync(new URL("../catalog/model-rates.v1.json", import.meta.url), "utf8"),
  ) as unknown;

  it("validates against its own schema", () => {
    expect(() => assertValidModelRateCatalog(shipped)).not.toThrow();
  });

  it("has no rule that shadows a more specific one", () => {
    // The bug this guards is not hypothetical: the Rust table this catalog replaces billed
    // Opus 4.5 at Opus 4's rate -- three times over -- because "claude-opus-4-5" contains
    // "claude-opus-4" and the general rule came first.
    const { entries } = shipped as { entries: Array<{ provider: string; match: { mode: string; value: string } }> };
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        if (entries[i].provider !== entries[j].provider) continue;
        if (entries[i].match.mode !== "contains" || entries[j].match.mode !== "contains") continue;
        if (entries[i].match.value === entries[j].match.value) continue;
        expect(
          entries[j].match.value.includes(entries[i].match.value),
          `entries[${j}] "${entries[j].match.value}" is unreachable behind entries[${i}] "${entries[i].match.value}"`,
        ).toBe(false);
      }
    }
  });

  it("prices every model id the Rust rate table prices", () => {
    // The migration's own completion check. The agent's rate_for_model cannot be retired until
    // the catalog is a SUPERSET of it, or retiring it would silently drop rates. Listed
    // explicitly rather than parsed out of Rust, so this test states a target rather than
    // agreeing with whatever the source happens to say today.
    const rustPrices = [
      "claude-fable-5", "claude-mythos-5", "claude-opus-5", "claude-sonnet-5",
      "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5",
      "claude-opus-4", "claude-sonnet-4", "claude-haiku-4-5", "claude-haiku",
      "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5",
      "gpt-5-mini", "gpt-5-nano", "gpt-5", "gpt-4o-mini", "gpt-4o",
    ];
    const { entries } = shipped as { entries: Array<{ match: { value: string } }> };
    const covered = new Set(entries.map((e) => e.match.value));
    const missing = rustPrices.filter((id) => !covered.has(id));
    expect(missing, `still only in Rust: ${missing.join(", ")}`).toEqual([]);
  });
});
