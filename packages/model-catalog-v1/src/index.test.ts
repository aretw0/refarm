import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	assertValidModelRateCatalog,
	assertValidModelTariffCatalog,
	resolveModelRate,
	resolveModelTariff,
	type ModelRateCatalog,
	type ModelTariffCatalog,
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

describe("a rate the catalog deliberately does not carry", () => {
  const entry = (patch: Record<string, unknown>): unknown => ({
    schemaVersion: "model-rate-catalog.v1",
    catalogVersion: "2026-08-04.6",
    entries: [
      {
        provider: "openai",
        match: { mode: "contains", value: "gpt-5.1-codex-mini" },
        pricingUrl: "https://developers.openai.com/api/docs/pricing",
        verifiedAt: "2026-08-03",
        ...patch,
      },
    ],
  });

  const unpriced = { reason: "not listed as its own line item", checkedAt: "2026-08-03" };
  const rate = { inputPerMTokenUsd: 1.25, outputPerMTokenUsd: 10 };

  it("accepts an entry whose absent rate carries a reason and a date", () => {
    expect(() => assertValidModelRateCatalog(entry({ unpriced }))).not.toThrow();
    expect(() =>
      assertValidModelRateCatalog(entry({ unpriced: { ...unpriced, note: "checked the pricing table" } })),
    ).not.toThrow();
  });

  it("refuses a rate and a reason-for-no-rate at the same time", () => {
    // The same rule contextWindow/contextWindowUnknown enforce: a figure and a reason for
    // having no figure cannot both be true, and a reader would have no way to tell which
    // one the entry means.
    expect(() => assertValidModelRateCatalog(entry({ rate, unpriced }))).toThrow(/\.unpriced/);
  });

  it("refuses an entry that carries neither", () => {
    // Silence is the state this whole field exists to remove. An entry with no rate and no
    // reason still MATCHES under first-match-wins and then answers nothing, which reads
    // downstream as "never heard of it" and sends the caller to a fallback that guesses.
    expect(() => assertValidModelRateCatalog(entry({}))).toThrow(/\.rate/);
  });

  it("refuses an unexplained or undated absence", () => {
    expect(() => assertValidModelRateCatalog(entry({ unpriced: { checkedAt: "2026-08-03" } }))).toThrow(
      /\.unpriced\.reason/,
    );
    expect(() =>
      assertValidModelRateCatalog(entry({ unpriced: { reason: "not listed" } })),
    ).toThrow(/\.unpriced\.checkedAt/);
    expect(() => assertValidModelRateCatalog(entry({ unpriced: "not listed" }))).toThrow(
      /\.unpriced/,
    );
  });

  it("tells an unpriced MATCH apart from no match at all", () => {
    // The three-state answer, checked at the resolver rather than only in the schema:
    // undefined means nothing matched; an entry with no tariff means the catalog looked and
    // there is no published rate. A caller that cannot tell them apart will fall back and
    // guess in the second case, which is exactly the failure being fixed.
    const catalog = entry({ unpriced }) as ModelRateCatalog;

    const matched = resolveModelRate(catalog, {
      provider: "openai",
      modelId: "gpt-5.1-codex-mini",
      at: "2026-08-04",
    });
    expect(matched).toBeDefined();
    expect(matched?.rate).toBeUndefined();
    expect(matched?.entry.unpriced?.reason).toBe("not listed as its own line item");
    expect(matched?.entry.unpriced?.checkedAt).toBe("2026-08-03");

    const missed = resolveModelRate(catalog, {
      provider: "openai",
      modelId: "gpt-4o",
      at: "2026-08-04",
    });
    expect(missed).toBeUndefined();

    // Same three answers under the tariff-first name.
    const tariffCatalog = { ...catalog, schemaVersion: "model-tariff-catalog.v1" } as ModelTariffCatalog;
    const tariffMatch = resolveModelTariff(tariffCatalog, {
      provider: "openai",
      modelId: "gpt-5.1-codex-mini",
      at: "2026-08-04",
    });
    expect(tariffMatch?.entry.match.value).toBe("gpt-5.1-codex-mini");
    expect(tariffMatch?.tariff).toBeUndefined();
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

  it("refuses to price gpt-5.1-codex-mini by association with the gpt-5 family", () => {
    // OpenAI does not list this id as its own line item, so the built-in Rust table answers
    // Unknown for it (checked 2026-08-03) — and once the guest consulted the catalog FIRST,
    // the catalog's "gpt-5" rule turned that deliberate refusal into a confident $1.25/$10.
    // The fix is in the artifact, not a second exclusion list in the guest: the id has its own
    // entry, ahead of the family rule, carrying `unpriced`.
    const resolved = resolveModelRate(shipped as ModelRateCatalog, {
      provider: "openai",
      modelId: "gpt-5.1-codex-mini",
      at: "2026-08-04",
    });

    expect(resolved?.entry.match.value).toBe("gpt-5.1-codex-mini");
    expect(resolved?.rate).toBeUndefined();
    expect(resolved?.entry.unpriced?.checkedAt).toBe("2026-08-03");

    // The family rule it sits in front of still prices its own members.
    expect(
      resolveModelRate(shipped as ModelRateCatalog, {
        provider: "openai",
        modelId: "gpt-5",
        at: "2026-08-04",
      })?.rate,
    ).toEqual({ inputPerMTokenUsd: 1.25, outputPerMTokenUsd: 10 });
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
