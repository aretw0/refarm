import { describe, expect, it } from "vitest";
import { createNullTrustSummary } from "../src/index.js";

describe("trust summary contracts", () => {
  it("creates a null summary with dev profile and zero counts", () => {
    expect(createNullTrustSummary()).toEqual({
      profile: "dev",
      warnings: 0,
      critical: 0,
    });
  });

  it("accepts a custom profile string", () => {
    expect(createNullTrustSummary("prod")).toEqual({
      profile: "prod",
      warnings: 0,
      critical: 0,
    });
  });
});
