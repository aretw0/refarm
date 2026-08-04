export type MatchMode = "contains" | "exact";

export interface ModelMatchRule {
  mode: MatchMode;
  value: string;
}

export interface ModelTariff {
  inputPerMTokenUsd: number;
  outputPerMTokenUsd: number;
}

export type ModelRate = ModelTariff;

/**
 * A model's maximum context window, in tokens, carrying its OWN source and verification date
 * rather than borrowing the entry's `pricingUrl`/`verifiedAt`.
 *
 * Two facts about the same model can come from two different vendor pages — the price often
 * lives on a pricing page and the window on a models/specs page — and a citation must cover
 * exactly what it claims. Sharing one date between them would let a re-verified price silently
 * re-date an unchecked window.
 *
 * Optional by design: a vendor that does not publish the figure leaves it ABSENT. A guessed
 * window is worse than no window, because a number that looks like data flows into routing
 * decisions.
 */
export interface ModelContextWindow {
  tokens: number;
  sourceUrl: string;
  verifiedAt: string;
}

/**
 * Why an entry has no verified `contextWindow`, so that absence carries a reason instead of a
 * shrug. A missing figure has at least two very different causes and they must not look alike:
 *
 * - `not-published` — the vendor's own model page was found and read, and it states no figure.
 *   Nothing more to do until the vendor publishes one.
 * - `source-not-found` — the vendor's page could not be located or did not load. This is a gap in
 *   OUR checking, not a fact about the vendor, and it is someone's next task.
 *
 * The distinction is not pedantry. Recording `not-published` for what was really
 * `source-not-found` states something about a third party that was never verified, and it closes
 * the question so nobody looks again. That mistake was made in this very catalog on 2026-08-04:
 * gemini-3-flash-preview was recorded as unpublished when the real cause was a 404 on a guessed
 * URL, and the vendor did publish the figure — 1,048,576 — on the page that was never reached.
 */
export interface ModelContextWindowUnknown {
  reason: "not-published" | "source-not-found";
  checkedAt: string;
  /** What was looked at, so the next attempt starts further along than the last one. */
  note?: string;
}

export interface ModelTariffEntry {
  provider: string;
  match: ModelMatchRule;
  rate: ModelTariff;
  pricingUrl: string;
  verifiedAt: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  contextWindow?: ModelContextWindow;
  contextWindowUnknown?: ModelContextWindowUnknown;
}

export type ModelRateEntry = ModelTariffEntry;

export interface ModelTariffCatalog {
  schemaVersion: "model-tariff-catalog.v1";
  catalogVersion: string;
  entries: ModelTariffEntry[];
}

export interface ModelRateCatalog {
  schemaVersion: "model-rate-catalog.v1";
  catalogVersion: string;
  entries: ModelRateEntry[];
}

export interface ResolveModelTariffRequest {
  provider: string;
  modelId: string;
  at?: string;
}

export type ResolveModelRateRequest = ResolveModelTariffRequest;

export interface ResolvedModelTariff {
  entry: ModelTariffEntry;
  tariff: ModelTariff;
}

export interface ResolvedModelRate {
  entry: ModelRateEntry;
  rate: ModelRate;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

function asDate(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function matchesRule(rule: ModelMatchRule, modelId: string): boolean {
  if (rule.mode === "exact") return modelId === rule.value;
  return modelId.includes(rule.value);
}

function matchesEffectiveWindow(entry: ModelTariffEntry, at: string): boolean {
  const when = asDate(at);
  if (!Number.isFinite(when)) return false;

  if (entry.effectiveFrom) {
    const from = asDate(entry.effectiveFrom);
    if (!Number.isFinite(from) || when < from) return false;
  }

  if (entry.effectiveTo) {
    const to = asDate(entry.effectiveTo);
    if (!Number.isFinite(to) || when > to) return false;
  }

  return true;
}

function validateModelTariffShape(
  catalog: unknown,
  schemaVersion: "model-rate-catalog.v1" | "model-tariff-catalog.v1",
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const value = catalog as Partial<ModelRateCatalog> & Partial<ModelTariffCatalog>;

  if (!value || typeof value !== "object") {
    return {
      valid: false,
      issues: [{ path: "$", message: "catalog must be an object" }],
    };
  }

  if (value.schemaVersion !== schemaVersion) {
    issues.push({ path: "schemaVersion", message: `must equal ${schemaVersion}` });
  }

  if (!value.catalogVersion || typeof value.catalogVersion !== "string") {
    issues.push({ path: "catalogVersion", message: "must be a non-empty string" });
  }

  if (!Array.isArray(value.entries)) {
    issues.push({ path: "entries", message: "must be an array" });
    return { valid: false, issues };
  }

  for (let i = 0; i < value.entries.length; i += 1) {
    const entry = value.entries[i] as Partial<ModelRateEntry>;
    const prefix = `entries[${i}]`;

    if (!entry || typeof entry !== "object") {
      issues.push({ path: prefix, message: "must be an object" });
      continue;
    }

    if (!entry.provider || typeof entry.provider !== "string") {
      issues.push({ path: `${prefix}.provider`, message: "must be a non-empty string" });
    }

    if (!entry.match || typeof entry.match !== "object") {
      issues.push({ path: `${prefix}.match`, message: "must be an object" });
    } else {
      if (entry.match.mode !== "contains" && entry.match.mode !== "exact") {
        issues.push({ path: `${prefix}.match.mode`, message: "must be contains or exact" });
      }
      if (!entry.match.value || typeof entry.match.value !== "string") {
        issues.push({ path: `${prefix}.match.value`, message: "must be a non-empty string" });
      }
    }

    if (!entry.rate || typeof entry.rate !== "object") {
      issues.push({ path: `${prefix}.rate`, message: "must be an object" });
    } else {
      if (typeof entry.rate.inputPerMTokenUsd !== "number" || entry.rate.inputPerMTokenUsd < 0) {
        issues.push({
          path: `${prefix}.rate.inputPerMTokenUsd`,
          message: "must be a non-negative number",
        });
      }
      if (typeof entry.rate.outputPerMTokenUsd !== "number" || entry.rate.outputPerMTokenUsd < 0) {
        issues.push({
          path: `${prefix}.rate.outputPerMTokenUsd`,
          message: "must be a non-negative number",
        });
      }
    }

    if (!entry.pricingUrl || typeof entry.pricingUrl !== "string") {
      issues.push({ path: `${prefix}.pricingUrl`, message: "must be a non-empty string" });
    }

    if (!entry.verifiedAt || typeof entry.verifiedAt !== "string") {
      issues.push({ path: `${prefix}.verifiedAt`, message: "must be a non-empty date string" });
    }

    // Absent is fine — a vendor that does not publish the figure gets no entry. But PRESENT
    // and unsourced is not: the same discipline pricingUrl/verifiedAt enforce above.
    if (entry.contextWindow !== undefined) {
      const cw = entry.contextWindow as Partial<ModelContextWindow>;
      if (!cw || typeof cw !== "object") {
        issues.push({ path: `${prefix}.contextWindow`, message: "must be an object when present" });
      } else {
        if (typeof cw.tokens !== "number" || !Number.isInteger(cw.tokens) || cw.tokens <= 0) {
          issues.push({
            path: `${prefix}.contextWindow.tokens`,
            message: "must be a positive integer",
          });
        }
        if (!cw.sourceUrl || typeof cw.sourceUrl !== "string") {
          issues.push({
            path: `${prefix}.contextWindow.sourceUrl`,
            message: "must be a non-empty string",
          });
        }
        if (!cw.verifiedAt || typeof cw.verifiedAt !== "string") {
          issues.push({
            path: `${prefix}.contextWindow.verifiedAt`,
            message: "must be a non-empty date string",
          });
        }
      }
    }

    if (entry.contextWindowUnknown !== undefined) {
      const gap = entry.contextWindowUnknown as Partial<ModelContextWindowUnknown>;
      if (!gap || typeof gap !== "object") {
        issues.push({
          path: `${prefix}.contextWindowUnknown`,
          message: "must be an object when present",
        });
      } else {
        if (gap.reason !== "not-published" && gap.reason !== "source-not-found") {
          issues.push({
            path: `${prefix}.contextWindowUnknown.reason`,
            message: "must be not-published or source-not-found",
          });
        }
        if (!gap.checkedAt || typeof gap.checkedAt !== "string") {
          issues.push({
            path: `${prefix}.contextWindowUnknown.checkedAt`,
            message: "must be a non-empty date string",
          });
        }
      }
    }

    // A figure and a reason for having no figure cannot both be true. Allowing both would let a
    // stale "we could not check" survive beside a value someone later verified, and a reader
    // would have no way to tell which one the entry means.
    if (entry.contextWindow !== undefined && entry.contextWindowUnknown !== undefined) {
      issues.push({
        path: `${prefix}.contextWindowUnknown`,
        message: "must not be set when contextWindow carries a verified figure",
      });
    }
  }

  return { valid: issues.length === 0, issues };
}

export function validateModelRateCatalog(catalog: unknown): ValidationResult {
  return validateModelTariffShape(catalog, "model-rate-catalog.v1");
}

export function validateModelTariffCatalog(catalog: unknown): ValidationResult {
  return validateModelTariffShape(catalog, "model-tariff-catalog.v1");
}

export function assertValidModelRateCatalog(catalog: unknown): asserts catalog is ModelRateCatalog {
  const result = validateModelRateCatalog(catalog);
  if (!result.valid) {
    const details = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(`Invalid model rate catalog: ${details}`);
  }
}

export function assertValidModelTariffCatalog(catalog: unknown): asserts catalog is ModelTariffCatalog {
  const result = validateModelTariffCatalog(catalog);
  if (!result.valid) {
    const details = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(`Invalid model tariff catalog: ${details}`);
  }
}

function resolveModelTariffEntry(
  entries: readonly ModelTariffEntry[],
  request: ResolveModelTariffRequest,
): ModelTariffEntry | undefined {
  const provider = request.provider.trim().toLowerCase();
  const at = request.at ?? new Date().toISOString().slice(0, 10);

  for (const entry of entries) {
    if (entry.provider.trim().toLowerCase() !== provider) continue;
    if (!matchesRule(entry.match, request.modelId)) continue;
    if (!matchesEffectiveWindow(entry, at)) continue;
    return entry;
  }

  return undefined;
}

export function resolveModelTariff(
  catalog: ModelTariffCatalog,
  request: ResolveModelTariffRequest,
): ResolvedModelTariff | undefined {
  const entry = resolveModelTariffEntry(catalog.entries, request);
  if (!entry) return undefined;
  return { entry, tariff: entry.rate };
}

export function resolveModelRate(
  catalog: ModelRateCatalog,
  request: ResolveModelRateRequest,
): ResolvedModelRate | undefined {
  const entry = resolveModelTariffEntry(catalog.entries, request);
  if (!entry) return undefined;
  return { entry, rate: entry.rate };
}
