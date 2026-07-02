import { resolveQualityProfile } from "./profile.js";
import {
	QUALITY_CAPABILITY,
	type QualityChecker,
	type QualityProfile,
	type QualityReport,
} from "./types.js";

export async function runQualityCheck<Subject>(
	checker: QualityChecker<Subject>,
	subject: Subject,
	profile: QualityProfile,
	profiles: Record<string, QualityProfile> = {},
): Promise<QualityReport> {
	const effectiveProfile = resolveQualityProfile(profile, profiles);
	const findings = await checker.check(subject, effectiveProfile);
	return {
		capability: QUALITY_CAPABILITY,
		checkerId: checker.checkerId,
		domain: checker.domain,
		profileName: effectiveProfile.name,
		findings,
		counts: countFindings(findings),
	};
}

export function countFindings(findings: { severity: string }[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const finding of findings) {
		counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
	}
	return counts;
}
