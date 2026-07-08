import { describe, expect, it } from "vitest";

import {
	buildRuntimePressureRecommendations,
	evaluateRuntimePressure,
	resolveRuntimePressureThresholds,
	type RuntimeTelemetrySnapshot,
	type RuntimeTelemetryWindow,
} from "./index.js";

function snapshot(
  overrides: Partial<RuntimeTelemetrySnapshot> = {},
): RuntimeTelemetrySnapshot {
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
  overrides: Partial<RuntimeTelemetryWindow> = {},
): RuntimeTelemetryWindow {
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

describe("runtime telemetry contract", () => {
  it("evaluates runtime pressure without app-specific commands", () => {
    const result = evaluateRuntimePressure({
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
      resolveRuntimePressureThresholds("balanced", {
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
      buildRuntimePressureRecommendations([
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
        summary: "Runtime pressure diagnostic custom:diagnostic is present.",
        action: "Inspect telemetry payload and runtime logs for the diagnostic source.",
      },
    ]);
  });
});
