import type { EnrichmentErrorCode, EnrichmentRecordResult, EnrichmentResult } from "./types.js";

/** A deterministic default timestamp for provenance in tests/fixtures. */
export const DEFAULT_NOW = "2026-06-30T00:00:00.000Z";

/** Stable, key-sorted JSON so a hash is stable regardless of property order. */
export function stableStringify(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
			left.localeCompare(right),
		);
		return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

/** An FNV-1a 32-bit content hash — enough to key provenance, not a crypto digest. */
export function stableHash(value: unknown): string {
	const text = stableStringify(value);
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function incrementCode(
	byCode: Partial<Record<EnrichmentErrorCode, number>>,
	code: EnrichmentErrorCode,
): void {
	byCode[code] = (byCode[code] ?? 0) + 1;
}

/** Tally an enrichment run — total, enriched (had changes), skipped (by code). */
export function buildDiagnostics(records: EnrichmentRecordResult[]): EnrichmentResult["diagnostics"] {
	const byCode: Partial<Record<EnrichmentErrorCode, number>> = {};
	let enriched = 0;
	let skipped = 0;
	for (const record of records) {
		if (record.skipped) {
			skipped += 1;
			incrementCode(byCode, record.skipped.code);
			continue;
		}
		if (record.changes.length > 0) enriched += 1;
	}
	return { total: records.length, enriched, skipped, byCode };
}
