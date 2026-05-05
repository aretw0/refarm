import { describe, it, expect } from "vitest";
import { createTrustSummaryFromTractor } from "../src/tractor-adapter.js";

describe("createTrustSummaryFromTractor", () => {
  it("uses defaultSecurityMode as profile", () => {
    const fakeTractor = { defaultSecurityMode: "strict" };
    const result = createTrustSummaryFromTractor(fakeTractor);
    expect(result.profile).toBe("strict");
  });

  it("returns zero warnings and critical for a fresh tractor", () => {
    const fakeTractor = { defaultSecurityMode: "permissive" };
    const result = createTrustSummaryFromTractor(fakeTractor);
    expect(result.warnings).toBe(0);
    expect(result.critical).toBe(0);
  });
});
