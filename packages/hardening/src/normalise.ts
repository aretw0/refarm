/**
 * NORMALISING THREE RESULT SHAPES INTO ONE.
 *
 * The suites were written independently and it shows. Three shapes are in the tree today:
 *
 *   · `{ pass, total, failed, failures: string[] }`      — 23 of the 26 suites;
 *   · `{ pass, total, failed, missing: DsToken[] }`      — `@refarm.dev/ds`, whose failures are
 *                                                          missing design tokens, not sentences;
 *   · `{ passed, issues: { code, message }[], … }`       — `@refarm.dev/homestead`'s host-renderer
 *                                                          report, which predates the family.
 *
 * H5 of the design doc is explicit that the work is a collector that NORMALISES what exists — not a
 * new framework the 26 would have to be rewritten against. So this reads all three rather than
 * demanding one, and an unrecognised fourth shape is reported as an unrecognised shape (a gap in
 * THIS file, named as such) instead of being silently scored as a pass.
 */

export interface NormalisedResult {
	/** Checks the suite ran, as the suite counts them. */
	checks: number;
	failed: number;
	/** One line per failure, whatever the suite called its failure list. */
	detail: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/** The failure list, under any of the names the three shapes use. `missing` holds tokens and
 *  `issues` holds objects, so each is rendered to a line rather than assumed to be a string. */
function detailFrom(result: Record<string, unknown>): string[] {
	const failures = result.failures;
	if (Array.isArray(failures)) return failures.map((entry) => renderDetail(entry));

	const missing = result.missing;
	if (Array.isArray(missing)) {
		return missing.length === 0 ? [] : [`missing: ${missing.map((entry) => renderDetail(entry)).join(", ")}`];
	}

	const issues = result.issues;
	if (Array.isArray(issues)) return issues.map((entry) => renderDetail(entry));

	return [];
}

function renderDetail(entry: unknown): string {
	if (typeof entry === "string") return entry;
	const record = asRecord(entry);
	if (record) {
		const message = record.message ?? record.detail ?? record.label;
		if (typeof message === "string") {
			return typeof record.code === "string" ? `${record.code}: ${message}` : message;
		}
	}
	return JSON.stringify(entry) ?? String(entry);
}

/**
 * Read a conformance result, or answer `null` when the value is not one.
 *
 * `null` is not "it failed" — it is "this collector cannot read this shape", which is a different
 * fact and is reported as one. Conflating them is exactly the H3 mistake, applied to the collector
 * itself.
 */
export function normaliseConformanceResult(value: unknown): NormalisedResult | null {
	const result = asRecord(value);
	if (!result) return null;

	const passed = result.pass ?? result.passed;
	if (typeof passed !== "boolean") return null;

	const detail = detailFrom(result);
	const failed = typeof result.failed === "number" ? result.failed : detail.length;
	const checks = typeof result.total === "number" ? result.total : failed;

	// A suite that says it passed while listing failures (or vice versa) is inconsistent about its
	// own verdict; trust the verdict it published and record the discrepancy as detail, so the
	// disagreement is visible instead of resolved silently in either direction.
	if (passed && failed > 0) {
		return {
			checks,
			failed,
			detail: [
				`the suite reported pass:true with ${failed} failure(s) — its verdict and its list disagree`,
				...detail,
			],
		};
	}
	if (!passed && failed === 0 && detail.length === 0) {
		return { checks, failed: 1, detail: ["the suite reported a failure but listed none"] };
	}

	return { checks, failed, detail };
}
