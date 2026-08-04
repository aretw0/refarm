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

export interface ModelTariffEntry {
  provider: string;
  match: ModelMatchRule;
  rate: ModelTariff;
  pricingUrl: string;
  verifiedAt: string;
  effectiveFrom?: string;
  effectiveTo?: string;
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
