// This is the NATIVE (in-process) face of quality:v1. Its sovereign, sandboxed
// sibling is the WASM component contract in `wit/quality.wit` (package
// `plugin:quality@0.1.0`, world `quality-checker`). The two are the same
// contract two ways — a checker is satisfied in-process here OR as a pure-compute
// WASM component; the host aggregates either's findings into one QualityReport
// ("native ↔ WASM parity", spec §3). Keep the shapes below in step with the WIT
// records (QualityRule↔rule, QualityFinding↔finding, …) so the boundary can't
// drift; the WIT uses kebab-case (rule-id) for the same fields.
export const QUALITY_CAPABILITY = "quality:v1" as const;

export interface QualityRule {
	id: string;
	severity: string;
	description: string;
	category?: string;
	check: {
		type: string;
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

export interface QualityProfile {
	name: string;
	extends?: string;
	rules: QualityRule[];
	[key: string]: unknown;
}

export interface QualityFinding {
	severity: string;
	ruleId: string;
	message: string;
	locus?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface QualityReport {
	capability: typeof QUALITY_CAPABILITY;
	checkerId: string;
	domain: string;
	profileName: string;
	findings: QualityFinding[];
	counts: Record<string, number>;
	metrics?: Record<string, unknown>;
}

export interface QualityChecker<Subject = unknown> {
	readonly checkerId: string;
	readonly domain: string;
	check(subject: Subject, profile: QualityProfile): QualityFinding[] | Promise<QualityFinding[]>;
}

export interface QualityConformanceResult {
	pass: boolean;
	total: number;
	failed: number;
	failures: string[];
}

export interface QualityConformanceOptions<Subject = unknown> {
	subject?: Subject;
	profile?: QualityProfile;
	profiles?: Record<string, QualityProfile>;
	expectedRuleId?: string;
}
