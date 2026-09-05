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
 * Why an entry carries NO `rate`, so that a model the catalog KNOWS ABOUT can say "no verified
 * price" out loud instead of being priced by association with its family.
 *
 * The catalog used to have two states — a verified rate, or no entry at all — and "no entry at
 * all" is indistinguishable from "never heard of this id". That gap is not neutral: resolution is
 * first-match-wins over `contains` rules, so an id nobody could verify still matches its family's
 * rule and comes back with a plausible number that looks exactly like a checked fact.
 *
 * That is not hypothetical either. `gpt-5.1-codex-mini` is not listed on OpenAI's pricing page as
 * its own line item, so the Rust rate table deliberately answers Unknown for it (checked
 * 2026-08-03) — while the catalog's `contains: "gpt-5"` rule answered $1.25/$10. Once the guest
 * consulted the catalog first, the deliberate refusal became a confident price.
 *
 * This is `ModelContextWindowUnknown`'s discipline applied to the price: absence carries a reason
 * and the date it was established, so the next reader knows whether the question is closed or
 * merely unanswered.
 *
 * The entry still carries `pricingUrl`/`verifiedAt` — the page that was read, and when the entry
 * as a whole was checked against it — while `checkedAt` dates THIS fact, exactly as
 * `contextWindow` dates its own figure rather than borrowing the entry's.
 */
export interface ModelTariffUnpriced {
  /** Why no rate is carried — what was looked for on the vendor's page and not found. */
  reason: string;
  checkedAt: string;
  /** What was looked at, so the next attempt starts further along than the last one. */
  note?: string;
}

export type ModelRateUnpriced = ModelTariffUnpriced;

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
  /**
   * The verified rate. Absent EXACTLY when `unpriced` says why it is absent: the validator refuses
   * an entry carrying both, and an entry carrying neither. Same rule, same reason as
   * `contextWindow`/`contextWindowUnknown` below — a figure and a reason for having no figure
   * cannot both be true, and an entry that states neither says nothing at all.
   */
  rate?: ModelTariff;
  /** Present only when `rate` is not. See {@link ModelTariffUnpriced}. */
  unpriced?: ModelTariffUnpriced;
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

/**
 * THREE answers, not two. `undefined` from the resolver means no entry matched; a result carrying
 * `tariff` is a verified price; a result WITHOUT one is an entry that matched and deliberately
 * carries no rate (see {@link ModelTariffUnpriced}).
 *
 * Collapsing the last two into `undefined` would rebuild the defect `unpriced` exists to remove:
 * a caller that cannot tell "this catalog has never heard of the id" from "this catalog checked
 * and there is no published rate" will reach for a fallback that guesses, and the guess is
 * indistinguishable from a checked fact once it is a number.
 */
export interface ResolvedModelTariff {
  entry: ModelTariffEntry;
  tariff?: ModelTariff;
}

export interface ResolvedModelRate {
  entry: ModelRateEntry;
  rate?: ModelRate;
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

    if (entry.rate !== undefined) {
      if (!entry.rate || typeof entry.rate !== "object") {
        issues.push({ path: `${prefix}.rate`, message: "must be an object when present" });
      } else {
        if (typeof entry.rate.inputPerMTokenUsd !== "number" || entry.rate.inputPerMTokenUsd < 0) {
          issues.push({
            path: `${prefix}.rate.inputPerMTokenUsd`,
            message: "must be a non-negative number",
          });
        }
        if (
          typeof entry.rate.outputPerMTokenUsd !== "number" ||
          entry.rate.outputPerMTokenUsd < 0
        ) {
          issues.push({
            path: `${prefix}.rate.outputPerMTokenUsd`,
            message: "must be a non-negative number",
          });
        }
      }
    }

    if (entry.unpriced !== undefined) {
      const gap = entry.unpriced as Partial<ModelTariffUnpriced>;
      if (!gap || typeof gap !== "object") {
        issues.push({ path: `${prefix}.unpriced`, message: "must be an object when present" });
      } else {
        if (!gap.reason || typeof gap.reason !== "string") {
          issues.push({ path: `${prefix}.unpriced.reason`, message: "must be a non-empty string" });
        }
        if (!gap.checkedAt || typeof gap.checkedAt !== "string") {
          issues.push({
            path: `${prefix}.unpriced.checkedAt`,
            message: "must be a non-empty date string",
          });
        }
        if (gap.note !== undefined && typeof gap.note !== "string") {
          issues.push({ path: `${prefix}.unpriced.note`, message: "must be a string when present" });
        }
      }
    }

    // A rate and a reason for having no rate cannot both be true, and an entry that states
    // NEITHER says nothing at all — it would match a model id under first-match-wins and then
    // answer with no answer, which reads downstream as a miss and sends the caller to whatever
    // fallback it has. Exactly one, always. (Same rule as contextWindow/contextWindowUnknown
    // below, and for the same reason; only the direction of the damage differs, because a
    // missing price is a number somebody else will supply.)
    if (entry.rate !== undefined && entry.unpriced !== undefined) {
      issues.push({
        path: `${prefix}.unpriced`,
        message: "must not be set when rate carries a verified figure",
      });
    }
    if (entry.rate === undefined && entry.unpriced === undefined) {
      issues.push({
        path: `${prefix}.rate`,
        message: "must be an object, or unpriced must say why no rate is carried",
      });
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

  issues.push(...shadowedEntryIssues(value.entries as ModelTariffEntry[]));

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

/**
 * Entries resolve FIRST-MATCH-WINS in array order, so a general `contains` rule placed ahead of a
 * more specific one makes the specific rule unreachable — permanently, and silently, because the
 * general rule answers with a plausible price instead of failing.
 *
 * This is not a hypothetical. The Rust rate table this catalog is replacing shipped exactly that
 * bug: `"claude-opus-4-5".contains("claude-opus-4")` is true, so Opus 4.5 was billed at Opus 4's
 * rate — three times the real price — until somebody read the vendor page. Carrying the data over
 * without carrying a guard would carry the hazard over with it.
 *
 * The invariant, checked per provider: if entry A's `contains` value is a substring of entry B's,
 * A must come AFTER B. Anything else means B can never be reached.
 *
 * `exact` rules cannot shadow and cannot be shadowed, so they are exempt.
 */
function shadowedEntryIssues(entries: readonly ModelTariffEntry[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const earlier = entries[i];
    if (earlier?.match?.mode !== "contains" || typeof earlier.match.value !== "string") continue;
    for (let j = i + 1; j < entries.length; j += 1) {
      const later = entries[j];
      if (later?.match?.mode !== "contains" || typeof later.match.value !== "string") continue;
      if (earlier.provider?.trim().toLowerCase() !== later.provider?.trim().toLowerCase()) continue;
      if (earlier.match.value === later.match.value) continue;
      if (!later.match.value.includes(earlier.match.value)) continue;
      issues.push({
        path: `entries[${j}].match.value`,
        message:
          `"${later.match.value}" can never be reached: entries[${i}] matches "${earlier.match.value}", ` +
          `a substring of it, and resolution is first-match-wins. Move the more specific rule first.`,
      });
    }
  }
  return issues;
}

/**
 * The matched entry, or `undefined` when nothing matched.
 *
 * The signature does not need a third case: since `rate` is optional and mutually exclusive with
 * `unpriced`, the returned ENTRY already distinguishes "matched, priced" from "matched, and the
 * catalog says there is no verified price". Wrapping it in a second discriminated union would
 * encode the same fact twice, and two encodings of one fact drift.
 */
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

/**
 * `undefined` means NO ENTRY MATCHED. A matched entry that deliberately carries no rate comes
 * back with its `entry` and no `tariff` — see {@link ResolvedModelTariff}.
 */
export function resolveModelTariff(
  catalog: ModelTariffCatalog,
  request: ResolveModelTariffRequest,
): ResolvedModelTariff | undefined {
  const entry = resolveModelTariffEntry(catalog.entries, request);
  if (!entry) return undefined;
  return entry.rate ? { entry, tariff: entry.rate } : { entry };
}

/** Same three answers as {@link resolveModelTariff}, under the compatibility name. */
export function resolveModelRate(
  catalog: ModelRateCatalog,
  request: ResolveModelRateRequest,
): ResolvedModelRate | undefined {
  const entry = resolveModelTariffEntry(catalog.entries, request);
  if (!entry) return undefined;
  return entry.rate ? { entry, rate: entry.rate } : { entry };
}
