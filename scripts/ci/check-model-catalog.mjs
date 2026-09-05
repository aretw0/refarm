#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../..");
const catalogPath = path.join(root, "packages/model-catalog-v1/catalog/model-rates.v1.json");

const providerModeByPrefix = [
  ["anthropic", "input-output"],
  ["openai", "input-output"],
  ["xai", "input-output"],
  ["deepseek", "input-output"],
  ["gemini", "input-output"],
  ["groq", "input-output"],
  ["mistral", "input-output"],
];

function fail(message) {
  console.error(`model-catalog: ${message}`);
  process.exit(1);
}

function parseDate(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function modeForProvider(provider) {
  const normalized = String(provider).toLowerCase();
  for (const [prefix, mode] of providerModeByPrefix) {
    if (normalized.startsWith(prefix)) return mode;
  }
  return "input-output";
}

function hasOverlap(a, b) {
  const min = Number.NEGATIVE_INFINITY;
  const max = Number.POSITIVE_INFINITY;

  const aStart = a.effectiveFrom ? parseDate(a.effectiveFrom) : min;
  const aEnd = a.effectiveTo ? parseDate(a.effectiveTo) : max;
  const bStart = b.effectiveFrom ? parseDate(b.effectiveFrom) : min;
  const bEnd = b.effectiveTo ? parseDate(b.effectiveTo) : max;

  return aStart <= bEnd && bStart <= aEnd;
}

const raw = await readFile(catalogPath, "utf8");
const catalog = JSON.parse(raw);

if (catalog?.schemaVersion !== "model-rate-catalog.v1") {
  fail("schemaVersion must be model-rate-catalog.v1");
}

if (!catalog.catalogVersion || typeof catalog.catalogVersion !== "string") {
  fail("catalogVersion must be a non-empty string");
}

if (!Array.isArray(catalog.entries) || catalog.entries.length === 0) {
  fail("entries must be a non-empty array");
}

const collisions = [];
for (let i = 0; i < catalog.entries.length; i += 1) {
  const entry = catalog.entries[i];

  if (!entry.provider || typeof entry.provider !== "string") {
    fail(`entries[${i}].provider must be a non-empty string`);
  }
  if (!entry.match || typeof entry.match !== "object") {
    fail(`entries[${i}].match must be an object`);
  }
  if (entry.match.mode !== "contains" && entry.match.mode !== "exact") {
    fail(`entries[${i}].match.mode must be contains or exact`);
  }
  if (!entry.match.value || typeof entry.match.value !== "string") {
    fail(`entries[${i}].match.value must be a non-empty string`);
  }

  // Exactly one of `rate` and `unpriced`, mirroring validateModelRateCatalog in
  // packages/model-catalog-v1/src/index.ts. This script cannot import that package without
  // adding a build-order dependency to CI (the seam is documented in that package's
  // index.test.ts, which runs the real validator against this same file), so the shape rules
  // are restated here and must be kept in step with it.
  //
  // An entry may deliberately carry NO rate: a model the catalog knows about whose price the
  // vendor does not publish says so, with a reason and a date, instead of being priced by a
  // family rule it happens to be a substring of.
  const hasRate = entry.rate !== undefined;
  const hasUnpriced = entry.unpriced !== undefined;
  if (hasRate && hasUnpriced) {
    fail(`entries[${i}].unpriced must not be set when rate carries a verified figure`);
  }
  if (!hasRate && !hasUnpriced) {
    fail(`entries[${i}].rate must be an object, or unpriced must say why no rate is carried`);
  }

  if (hasRate) {
    if (!entry.rate || typeof entry.rate !== "object") {
      fail(`entries[${i}].rate must be an object`);
    }
    if (typeof entry.rate.inputPerMTokenUsd !== "number" || entry.rate.inputPerMTokenUsd < 0) {
      fail(`entries[${i}].rate.inputPerMTokenUsd must be a non-negative number`);
    }
    if (typeof entry.rate.outputPerMTokenUsd !== "number" || entry.rate.outputPerMTokenUsd < 0) {
      fail(`entries[${i}].rate.outputPerMTokenUsd must be a non-negative number`);
    }
  }

  if (hasUnpriced) {
    if (!entry.unpriced || typeof entry.unpriced !== "object") {
      fail(`entries[${i}].unpriced must be an object`);
    }
    if (!entry.unpriced.reason || typeof entry.unpriced.reason !== "string") {
      fail(`entries[${i}].unpriced.reason must be a non-empty string`);
    }
    if (
      !entry.unpriced.checkedAt ||
      typeof entry.unpriced.checkedAt !== "string" ||
      !Number.isFinite(parseDate(entry.unpriced.checkedAt))
    ) {
      fail(`entries[${i}].unpriced.checkedAt must be a valid date`);
    }
  }

  if (!entry.pricingUrl || typeof entry.pricingUrl !== "string") {
    fail(`entries[${i}].pricingUrl must be a non-empty string`);
  }
  if (!entry.verifiedAt || typeof entry.verifiedAt !== "string" || !Number.isFinite(parseDate(entry.verifiedAt))) {
    fail(`entries[${i}].verifiedAt must be a valid date`);
  }

  if (entry.effectiveFrom && !Number.isFinite(parseDate(entry.effectiveFrom))) {
    fail(`entries[${i}].effectiveFrom must be a valid date`);
  }
  if (entry.effectiveTo && !Number.isFinite(parseDate(entry.effectiveTo))) {
    fail(`entries[${i}].effectiveTo must be a valid date`);
  }
  if (entry.effectiveFrom && entry.effectiveTo && parseDate(entry.effectiveFrom) > parseDate(entry.effectiveTo)) {
    fail(`entries[${i}] has effectiveFrom after effectiveTo`);
  }

  if (modeForProvider(entry.provider) !== "input-output") {
    fail(`entries[${i}] provider mode not supported: ${entry.provider}`);
  }

  for (let j = i + 1; j < catalog.entries.length; j += 1) {
    const other = catalog.entries[j];
    const sameProvider = String(entry.provider).toLowerCase() === String(other.provider).toLowerCase();
    const sameMode = entry.match.mode === other.match.mode;
    const sameValue = entry.match.value === other.match.value;
    if (!sameProvider || !sameMode || !sameValue) continue;
    if (!hasOverlap(entry, other)) continue;

    collisions.push({
      left: i,
      right: j,
      provider: entry.provider,
      match: entry.match,
    });
  }
}

if (collisions.length > 0) {
  fail(
    `found ${collisions.length} overlapping entries for same provider/match: ` +
      collisions
        .map((c) => `[${c.left},${c.right}] ${c.provider} ${c.match.mode}:${c.match.value}`)
        .join("; "),
  );
}

console.log(
  `model-catalog: ok (${catalog.entries.length} entries, version ${catalog.catalogVersion})`,
);
