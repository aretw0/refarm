// The pure, symmetric counterpart of artifact-contract-v1's
// validateTaskArtifactManifest: a QualityReport is a JSON envelope any producer
// can emit — a TypeScript checker in-process, a WASM component, or a Python
// engine writing a file — and a consumer needs one function that says whether
// the envelope holds, with a path per defect. runQualityV1Conformance cannot do
// this: it exercises a checker over a text subject, not a report that already
// exists. The first producer that needed this was not JavaScript
// (arch-engine, 2026-08-29).
import { QUALITY_CAPABILITY, type QualityReport } from "./types.js";

export interface QualityReportValidationIssue {
	path: string;
	message: string;
}

export interface QualityReportValidationResult {
	ok: boolean;
	issues: readonly QualityReportValidationIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function requireString(
	value: unknown,
	path: string,
	issues: QualityReportValidationIssue[],
): void {
	if (!isNonEmptyString(value)) {
		issues.push({ path, message: "Expected a non-empty string." });
	}
}

function validateFinding(
	value: unknown,
	path: string,
	issues: QualityReportValidationIssue[],
): void {
	if (!isRecord(value)) {
		issues.push({ path, message: "Expected a finding object." });
		return;
	}
	requireString(value.severity, `${path}.severity`, issues);
	requireString(value.ruleId, `${path}.ruleId`, issues);
	requireString(value.message, `${path}.message`, issues);
	if (value.locus !== undefined && !isRecord(value.locus)) {
		issues.push({ path: `${path}.locus`, message: "Expected a locus object." });
	}
}

/**
 * Validate a `quality:v1` report envelope produced by ANY checker, in any
 * language. Checks the capability tag, the identifying strings, every finding's
 * required fields, and that `counts` is exactly the per-severity tally of
 * `findings` — the invariant `runQualityCheck` guarantees for in-process
 * checkers and an external producer must uphold on its own. PURE.
 */
export function validateQualityReport(value: unknown): QualityReportValidationResult {
	const issues: QualityReportValidationIssue[] = [];
	if (!isRecord(value)) {
		return { ok: false, issues: [{ path: "$", message: "Expected a quality report object." }] };
	}
	if (value.capability !== QUALITY_CAPABILITY) {
		issues.push({ path: "$.capability", message: `Expected ${QUALITY_CAPABILITY}.` });
	}
	requireString(value.checkerId, "$.checkerId", issues);
	requireString(value.domain, "$.domain", issues);
	requireString(value.profileName, "$.profileName", issues);

	const tally: Record<string, number> = {};
	if (!Array.isArray(value.findings)) {
		issues.push({ path: "$.findings", message: "Expected an array." });
	} else {
		value.findings.forEach((finding, index) => {
			validateFinding(finding, `$.findings.${index}`, issues);
			if (isRecord(finding) && isNonEmptyString(finding.severity)) {
				tally[finding.severity] = (tally[finding.severity] ?? 0) + 1;
			}
		});
	}

	if (!isRecord(value.counts)) {
		issues.push({ path: "$.counts", message: "Expected a counts object." });
	} else if (Array.isArray(value.findings)) {
		for (const [severity, count] of Object.entries(value.counts)) {
			if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
				issues.push({ path: `$.counts.${severity}`, message: "Expected a non-negative integer." });
			} else if (count !== (tally[severity] ?? 0)) {
				issues.push({
					path: `$.counts.${severity}`,
					message: `Expected ${tally[severity] ?? 0} from findings, got ${count}.`,
				});
			}
		}
		for (const severity of Object.keys(tally)) {
			if (!(severity in value.counts)) {
				issues.push({ path: `$.counts.${severity}`, message: "Missing severity present in findings." });
			}
		}
	}

	if (value.metrics !== undefined && !isRecord(value.metrics)) {
		issues.push({ path: "$.metrics", message: "Expected a metrics object." });
	}
	return { ok: issues.length === 0, issues };
}

export function isQualityReport(value: unknown): value is QualityReport {
	return validateQualityReport(value).ok;
}
