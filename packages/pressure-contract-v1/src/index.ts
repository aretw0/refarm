export interface PressureSnapshot {
  queueDepth: number;
  inFlight: number;
  cancelRequests: number;
  generatedAt: string;
  total: number;
  pending: number;
  inProgress: number;
  done: number;
  failed: number;
  cancelled: number;
}

export interface PressureWindow {
  windowMinutes: number;
  since: string;
  terminal: number;
  failureRatePct: number | null;
  generatedAt: string;
  total: number;
  pending: number;
  inProgress: number;
  done: number;
  failed: number;
  cancelled: number;
}

export type PressureDiagnostic =
  | "saturation:queue"
  | "saturation:inflight"
  | "reliability:failures-present"
  | "reliability:failures-recent"
  | "reliability:failure-rate"
  | (string & {});

export type PressureProfileName =
  | "conservative"
  | "balanced"
  | "throughput";

export interface PressureThresholds {
  profile: PressureProfileName;
  queueWarn: number;
  inflightWarn: number;
  failRateWarn: number;
}

export type PressureThresholdOverrides = Partial<
  Omit<PressureThresholds, "profile">
>;

export interface PressureStrictResult {
  enabled: boolean;
  targets: PressureDiagnostic[];
  matchedDiagnostics: PressureDiagnostic[];
  passed: boolean;
}

export interface PressureEvaluationInput {
  snapshot: PressureSnapshot;
  window?: PressureWindow | null;
  profile?: PressureProfileName;
  thresholds?: PressureThresholdOverrides;
  strict?: boolean;
  strictOn?: PressureDiagnostic[];
}

export interface PressureEvaluation {
  ok: boolean;
  snapshot: PressureSnapshot;
  window: PressureWindow | null;
  thresholds: PressureThresholds;
  diagnostics: PressureDiagnostic[];
  strict: PressureStrictResult;
}

export interface PressureRecommendation {
  diagnostic: PressureDiagnostic;
  summary: string;
  action: string;
}

const PROFILE_THRESHOLDS: Record<
  PressureProfileName,
  Omit<PressureThresholds, "profile">
> = {
  conservative: {
    queueWarn: 5,
    inflightWarn: 2,
    failRateWarn: 5,
  },
  balanced: {
    queueWarn: 10,
    inflightWarn: 4,
    failRateWarn: 15,
  },
  throughput: {
    queueWarn: 20,
    inflightWarn: 8,
    failRateWarn: 30,
  },
};

export function isPressureProfileName(
  raw: string,
): raw is PressureProfileName {
  return raw === "conservative" || raw === "balanced" || raw === "throughput";
}

function positiveNumberOrFallback(
  raw: number | undefined,
  fallback: number,
): number {
  return Number.isFinite(raw) && raw !== undefined && raw > 0 ? raw : fallback;
}

function positiveIntOrFallback(
  raw: number | undefined,
  fallback: number,
): number {
  return Math.floor(positiveNumberOrFallback(raw, fallback));
}

export function resolvePressureThresholds(
  profile: PressureProfileName,
  overrides: PressureThresholdOverrides = {},
): PressureThresholds {
  const base = PROFILE_THRESHOLDS[profile];
  return {
    profile,
    queueWarn: positiveIntOrFallback(overrides.queueWarn, base.queueWarn),
    inflightWarn: positiveIntOrFallback(overrides.inflightWarn, base.inflightWarn),
    failRateWarn: positiveNumberOrFallback(
      overrides.failRateWarn,
      base.failRateWarn,
    ),
  };
}

export function evaluatePressure(
  input: PressureEvaluationInput,
): PressureEvaluation {
  const profile = input.profile ?? "balanced";
  const thresholds = resolvePressureThresholds(
    profile,
    input.thresholds,
  );
  const diagnostics: PressureDiagnostic[] = [];

  if (input.snapshot.queueDepth >= thresholds.queueWarn) {
    diagnostics.push("saturation:queue");
  }
  if (input.snapshot.inFlight >= thresholds.inflightWarn) {
    diagnostics.push("saturation:inflight");
  }
  if (input.snapshot.failed > 0) {
    diagnostics.push("reliability:failures-present");
  }
  if (input.window) {
    if (input.window.failed > 0) {
      diagnostics.push("reliability:failures-recent");
    }
    if (
      input.window.failureRatePct !== null &&
      input.window.failureRatePct >= thresholds.failRateWarn
    ) {
      diagnostics.push("reliability:failure-rate");
    }
  }

  const targets = input.strictOn ?? [];
  const matchedDiagnostics =
    targets.length > 0
      ? diagnostics.filter((diagnostic) => targets.includes(diagnostic))
      : [...diagnostics];
  const strict = {
    enabled: !!input.strict,
    targets,
    matchedDiagnostics,
    passed: !input.strict || matchedDiagnostics.length === 0,
  };

  return {
    ok: diagnostics.length === 0,
    snapshot: input.snapshot,
    window: input.window ?? null,
    thresholds,
    diagnostics,
    strict,
  };
}

export function buildPressureRecommendations(
  diagnostics: PressureDiagnostic[],
): PressureRecommendation[] {
  return diagnostics.map((diagnostic) => {
    switch (diagnostic) {
      case "saturation:queue":
        return {
          diagnostic,
          summary: "The task queue is above the configured warning threshold.",
          action:
            "Reduce new submissions, scale workers, or inspect long-running work before dispatching more work.",
        };
      case "saturation:inflight":
        return {
          diagnostic,
          summary:
            "In-flight work count is above the configured warning threshold.",
          action:
            "Wait for active work to settle or increase worker capacity before starting more work.",
        };
      case "reliability:failures-present":
        return {
          diagnostic,
          summary: "Failed work is present in the current pressure snapshot.",
          action:
            "Inspect failed work logs and retry only after the failure cause is understood.",
        };
      case "reliability:failures-recent":
        return {
          diagnostic,
          summary: "Recent pressure window includes failed work.",
          action: "Inspect recent failures before continuing automated execution.",
        };
      case "reliability:failure-rate":
        return {
          diagnostic,
          summary: "Recent failure rate is above the configured warning threshold.",
          action:
            "Pause non-essential automation and investigate the dominant failing work.",
        };
      default:
        return {
          diagnostic,
          summary: `Pressure diagnostic ${diagnostic} is present.`,
          action: "Inspect pressure payload and host logs for the diagnostic source.",
        };
    }
  });
}

export { PROFILE_THRESHOLDS as PRESSURE_PROFILE_THRESHOLDS };
