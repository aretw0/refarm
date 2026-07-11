import type { QualityChecker, QualityFinding, QualityProfile, QualityRule } from "./types.js";

export interface RegexQualityCheckerOptions {
	checkerId?: string;
	domain?: string;
}

export function createRegexQualityChecker(
	options: RegexQualityCheckerOptions = {},
): QualityChecker<string> {
	return {
		checkerId: options.checkerId ?? "sovereign.reference-regex-quality",
		domain: options.domain ?? "text",
		check(subject, profile) {
			return runRegexQualityRules(subject, profile);
		},
	};
}

export function runRegexQualityRules(subject: string, profile: QualityProfile): QualityFinding[] {
	const findings: QualityFinding[] = [];
	for (const rule of profile.rules) {
		if (rule.check.type !== "regex") {
			continue;
		}

		const pattern = stringParam(rule, "pattern") ?? stringParam(rule, "regex");
		if (!pattern) {
			findings.push({
				severity: "fail",
				ruleId: rule.id,
				message: `Rule '${rule.id}' is missing check.pattern`,
			});
			continue;
		}

		const flags = stringParam(rule, "flags") ?? "g";
		const regex = new RegExp(pattern, flags.includes("g") ? flags : `${flags}g`);
		for (const match of subject.matchAll(regex)) {
			findings.push({
				severity: rule.severity,
				ruleId: rule.id,
				message: rule.description,
				locus: {
					index: match.index ?? 0,
					match: match[0],
				},
			});
		}
	}
	return findings;
}

function stringParam(rule: QualityRule, key: string): string | undefined {
	const value = rule.check[key];
	return typeof value === "string" ? value : undefined;
}
