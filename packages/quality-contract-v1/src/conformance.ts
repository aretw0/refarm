import { resolveQualityProfile } from "./profile.js";
import { runQualityCheck } from "./report.js";
import {
	QUALITY_CAPABILITY,
	type QualityChecker,
	type QualityConformanceOptions,
	type QualityConformanceResult,
	type QualityFinding,
	type QualityProfile,
} from "./types.js";

const BASE_PROFILE: QualityProfile = {
	name: "base",
	rules: [
		{
			id: "alpha",
			severity: "notice",
			description: "Flags alpha as an open-severity finding.",
			check: { type: "regex", pattern: "alpha" },
		},
	],
};

const STRICT_PROFILE: QualityProfile = {
	name: "strict",
	extends: "base",
	rules: [
		{
			id: "beta",
			severity: "fail",
			description: "Flags beta as a failure.",
			check: { type: "regex", pattern: "beta" },
		},
	],
};

export async function runQualityV1Conformance<Subject = string>(
	checker: QualityChecker<Subject>,
	options: QualityConformanceOptions<Subject> = {},
): Promise<QualityConformanceResult> {
	const failures: string[] = [];
	const subject = options.subject ?? ("alpha beta alpha" as Subject);
	const profile = options.profile ?? (STRICT_PROFILE as QualityProfile);
	const profiles = options.profiles ?? { base: BASE_PROFILE };
	const expectedRuleId = options.expectedRuleId ?? "alpha";

	if (!checker.checkerId || checker.checkerId.trim().length === 0) {
		failures.push("checker.checkerId must be a non-empty string");
	}

	if (!checker.domain || checker.domain.trim().length === 0) {
		failures.push("checker.domain must be a non-empty string");
	}

	try {
		const resolved = resolveQualityProfile(profile, profiles);
		if (!resolved.rules.some((rule) => rule.id === expectedRuleId)) {
			failures.push("profile composition must preserve parent rules");
		}
	} catch (error) {
		failures.push(`profile composition threw: ${String(error)}`);
	}

	try {
		const first = await runQualityCheck(checker, subject, profile, profiles);
		const second = await runQualityCheck(checker, subject, profile, profiles);

		if (first.capability !== QUALITY_CAPABILITY) {
			failures.push("report.capability must be 'quality:v1'");
		}

		if (JSON.stringify(first.findings) !== JSON.stringify(second.findings)) {
			failures.push("checker must be deterministic for identical subject/profile inputs");
		}

		if (!first.findings.some((finding) => finding.ruleId === expectedRuleId)) {
			failures.push(`checker must emit a finding for '${expectedRuleId}'`);
		}

		for (const finding of first.findings) {
			validateFinding(finding, failures);
		}

		for (const finding of first.findings) {
			if (first.counts[finding.severity] === undefined) {
				failures.push(`report.counts must include severity '${finding.severity}'`);
			}
		}
	} catch (error) {
		failures.push(`check() threw: ${String(error)}`);
	}

	const failed = failures.length;
	return {
		pass: failed === 0,
		total: 7,
		failed,
		failures,
	};
}

function validateFinding(finding: QualityFinding, failures: string[]): void {
	if (!finding.ruleId || finding.ruleId.trim().length === 0) {
		failures.push("findings[].ruleId must be a non-empty string");
	}
	if (!finding.severity || finding.severity.trim().length === 0) {
		failures.push("findings[].severity must be a non-empty string");
	}
	if (!finding.message || finding.message.trim().length === 0) {
		failures.push("findings[].message must be a non-empty string");
	}
}
