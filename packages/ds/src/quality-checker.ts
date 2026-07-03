import type {
	QualityChecker,
	QualityFinding,
	QualityProfile,
} from "@refarm.dev/quality-contract-v1";

import {
	runDsLint,
	type DsLintOptions,
	type DsLintSnapshot,
} from "./lint.js";

const CHECK_TYPE_TO_OPTION: Record<string, keyof DsLintOptions> = {
	contrast: "contrast",
	overflow: "overflow",
	"fluid-type": "fluidType",
	"heading-hierarchy": "headingHierarchy",
};

const SEVERITY_MAP: Record<string, string> = {
	error: "fail",
	warning: "warn",
};

export function createDsQualityChecker(): QualityChecker<DsLintSnapshot> {
	return {
		checkerId: "ds-lint",
		domain: "ui",
		check(subject: DsLintSnapshot, profile: QualityProfile): QualityFinding[] {
			const options = profileToDsLintOptions(profile);
			const report = runDsLint(subject, options);
			return report.issues.map((issue) => ({
				severity: SEVERITY_MAP[issue.severity] ?? issue.severity,
				ruleId: issue.ruleId,
				message: issue.message,
				locus: {
					...(issue.elementId ? { elementId: issue.elementId } : {}),
					...(issue.selector ? { selector: issue.selector } : {}),
					...(issue.details ?? {}),
				},
			}));
		},
	};
}

export function profileToDsLintOptions(profile: QualityProfile): DsLintOptions {
	const selected = new Set<keyof DsLintOptions>();
	for (const rule of profile.rules) {
		const option = CHECK_TYPE_TO_OPTION[rule.check.type];
		if (option) {
			selected.add(option);
		}
	}

	return {
		contrast: selected.has("contrast"),
		overflow: selected.has("overflow"),
		fluidType: selected.has("fluidType"),
		headingHierarchy: selected.has("headingHierarchy"),
	};
}
