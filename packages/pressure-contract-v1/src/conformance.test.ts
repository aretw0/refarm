import { describe, expect, it } from "vitest";

import {
	buildPressureRecommendations,
	evaluatePressure,
	resolvePressureThresholds,
	type PressureSnapshot,
	type PressureWindow,
} from "./index.js";

function snapshot(
  overrides: Partial<PressureSnapshot> = {},
): PressureSnapshot {
  return {
    queueDepth: 0,
    inFlight: 0,
    cancelRequests: 0,
    generatedAt: "2026-07-08T00:00:00.000Z",
    total: 0,
    pending: 0,
    inProgress: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
    ...overrides,
  };
}

function window(
  overrides: Partial<PressureWindow> = {},
): PressureWindow {
  return {
    windowMinutes: 15,
    since: "2026-07-07T23:45:00.000Z",
    terminal: 4,
    failureRatePct: null,
    generatedAt: "2026-07-08T00:00:00.000Z",
    total: 4,
    pending: 0,
    inProgress: 0,
    done: 4,
    failed: 0,
    cancelled: 0,
    ...overrides,
  };
}

describe("pressure contract", () => {
  it("evaluates pressure without app-specific commands", () => {
    const result = evaluatePressure({
      snapshot: snapshot({ queueDepth: 7, failed: 1 }),
      window: window({ failed: 1, failureRatePct: 25 }),
      profile: "conservative",
      strict: true,
      strictOn: ["reliability:failure-rate"],
    });

    expect(result.ok).toBe(false);
    expect(result.thresholds).toEqual({
      profile: "conservative",
      queueWarn: 5,
      inflightWarn: 2,
      failRateWarn: 5,
    });
    expect(result.diagnostics).toEqual([
      "saturation:queue",
      "reliability:failures-present",
      "reliability:failures-recent",
      "reliability:failure-rate",
    ]);
    expect(result.strict).toEqual({
      enabled: true,
      targets: ["reliability:failure-rate"],
      matchedDiagnostics: ["reliability:failure-rate"],
      passed: false,
    });
  });

  it("resolves threshold overrides from a named profile", () => {
    expect(
      resolvePressureThresholds("balanced", {
        queueWarn: 12,
        failRateWarn: 10,
      }),
    ).toEqual({
      profile: "balanced",
      queueWarn: 12,
      inflightWarn: 4,
      failRateWarn: 10,
    });
  });

  it("returns reusable pressure recommendations without app commands", () => {
    expect(
      buildPressureRecommendations([
        "saturation:queue",
        "custom:diagnostic",
      ]),
    ).toEqual([
      {
        diagnostic: "saturation:queue",
        summary: "The task queue is above the configured warning threshold.",
        action:
          "Reduce new submissions, scale workers, or inspect long-running work before dispatching more work.",
      },
      {
        diagnostic: "custom:diagnostic",
        summary: "Pressure diagnostic custom:diagnostic is present.",
        action: "Inspect pressure payload and host logs for the diagnostic source.",
      },
    ]);
    expect(
      buildPressureRecommendations([
        "reliability:failures-present",
        "reliability:failures-recent",
      ]).map((recommendation) => recommendation.summary),
    ).toEqual([
      "Failed work is present in the current pressure snapshot.",
      "Recent pressure window includes failed work.",
    ]);
  });
});
