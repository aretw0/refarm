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
	check(
		subject: Subject,
		profile: QualityProfile,
	): QualityFinding[] | Promise<QualityFinding[]>;
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
