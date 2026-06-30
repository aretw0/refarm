export const SKILL_CAPABILITY = "skill:v1" as const;
export const SKILL_MANIFEST_SCHEMA = "refarm.skill-manifest.v1" as const;

export type SkillExecutionMode = "plan-only" | "host-invoked";
export type SkillToolAccess = "declared-capabilities-only";

export interface SkillContractV1ConformanceResult {
	readonly pass: boolean;
	readonly total: number;
	readonly failed: number;
	readonly failures: readonly string[];
}

export interface SkillSourceRef {
	readonly format: "SKILL.md";
	readonly uri: string;
	readonly sha256: string;
	readonly bytes: number;
}

export interface SkillCapabilityEnvelope {
	readonly requires: readonly string[];
	readonly optional?: readonly string[];
	readonly provides?: readonly string[];
}

export interface SkillPolicyEnvelope {
	readonly executionMode: SkillExecutionMode;
	readonly toolAccess: SkillToolAccess;
}

export interface SkillManifestV1 {
	readonly schema: typeof SKILL_MANIFEST_SCHEMA;
	readonly id: string;
	readonly name: string;
	readonly description?: string;
	readonly source: SkillSourceRef;
	readonly capabilities: SkillCapabilityEnvelope;
	readonly policy: SkillPolicyEnvelope;
	readonly instructions: string;
	readonly frontmatter: Readonly<Record<string, string | readonly string[]>>;
}

export interface SkillManifestIssue {
	readonly code: string;
	readonly path: string;
	readonly message: string;
}

export interface SkillManifestValidationResult {
	readonly ok: boolean;
	readonly issues: readonly SkillManifestIssue[];
}

export interface SkillManifestParseOptions {
	readonly sourceUri?: string;
}

export interface SkillManifestParseResult extends SkillManifestValidationResult {
	readonly manifest: SkillManifestV1 | null;
}

export interface SkillContractV1Adapter {
	parseMarkdown(
		source: string,
		options?: SkillManifestParseOptions,
	): SkillManifestParseResult | Promise<SkillManifestParseResult>;
	validateManifest(
		manifest: unknown,
	): SkillManifestValidationResult | Promise<SkillManifestValidationResult>;
}
