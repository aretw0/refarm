export const SKILL_CAPABILITY = "skill:v1" as const;
export const SKILL_MANIFEST_SCHEMA = "refarm.skill-manifest.v1" as const;
export const SKILL_INVOCATION_PLAN_SCHEMA = "refarm.skill-invocation-plan.v1" as const;
export const SKILL_INVOCATION_REQUEST_SCHEMA = "refarm.skill-invocation-request.v1" as const;
export const SKILL_INVOCATION_DECISION_SCHEMA = "refarm.skill-invocation-decision.v1" as const;
export const SKILL_INVOCATION_RECEIPT_SCHEMA = "refarm.skill-invocation-receipt.v1" as const;
export const SKILL_ACTIVATION_PREFLIGHT_SCHEMA = "refarm.skill-activation-preflight.v1" as const;
export const SKILL_SOURCE_INTEGRITY_SCHEMA = "refarm.skill-source-integrity.v1" as const;

export type SkillExecutionMode = "plan-only" | "host-invoked";
export type SkillToolAccess = "declared-capabilities-only";
export type SkillInvocationPolicyDecision = "approved" | "denied";
export type SkillInvocationExecutionStatus = "succeeded" | "failed";

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

export interface SkillEngineBindingEnvelope {
	readonly requires: readonly string[];
	readonly optional?: readonly string[];
}

export interface SkillPolicyEnvelope {
	readonly executionMode: SkillExecutionMode;
	readonly toolAccess: SkillToolAccess;
}

export type SkillIoFormat = "text/markdown";

export interface SkillInputEnvelope {
	readonly format: SkillIoFormat;
	readonly required: boolean;
	readonly description?: string;
}

export interface SkillOutputEnvelope {
	readonly format: SkillIoFormat;
	readonly description?: string;
}

export interface SkillIoEnvelope {
	readonly input: SkillInputEnvelope;
	readonly output: SkillOutputEnvelope;
}

export interface SkillInvocationInputPayload {
	readonly format: SkillIoFormat;
	readonly body: string;
}

export interface SkillManifestV1 {
	readonly schema: typeof SKILL_MANIFEST_SCHEMA;
	readonly id: string;
	readonly name: string;
	readonly description?: string;
	readonly source: SkillSourceRef;
	readonly capabilities: SkillCapabilityEnvelope;
	readonly engineBindings: SkillEngineBindingEnvelope;
	readonly policy: SkillPolicyEnvelope;
	readonly io: SkillIoEnvelope;
	readonly instructions: string;
	readonly frontmatter: Readonly<Record<string, string | readonly string[]>>;
}

export interface SkillInvocationPlanCapability {
	readonly id: string;
	readonly required: boolean;
}

export interface SkillInvocationPlanSkillRef {
	readonly id: string;
	readonly name: string;
	readonly source: SkillSourceRef;
}

export interface SkillInvocationPlanV1 {
	readonly schema: typeof SKILL_INVOCATION_PLAN_SCHEMA;
	readonly skill: SkillInvocationPlanSkillRef;
	readonly policy: SkillPolicyEnvelope;
	readonly capabilityRequests: readonly SkillInvocationPlanCapability[];
	readonly engineBindings: SkillEngineBindingEnvelope;
	readonly io: SkillIoEnvelope;
	readonly instructions: string;
	readonly requiresHostPolicyApproval: true;
}

export interface SkillInvocationRequestV1 {
	readonly schema: typeof SKILL_INVOCATION_REQUEST_SCHEMA;
	readonly skill: SkillInvocationPlanSkillRef;
	readonly input: SkillInvocationInputPayload;
	readonly policy: SkillPolicyEnvelope;
	readonly capabilityRequests: readonly SkillInvocationPlanCapability[];
	readonly engineBindings: SkillEngineBindingEnvelope;
	readonly output: SkillOutputEnvelope;
	readonly requiresHostPolicyApproval: true;
}

export interface SkillInvocationCapabilityDecision {
	readonly id: string;
	readonly required: boolean;
	readonly decision: SkillInvocationPolicyDecision;
	readonly reason?: string;
}

export interface SkillInvocationDecisionOptions {
	readonly decision: SkillInvocationPolicyDecision;
	readonly reason: string;
	readonly approvedCapabilities?: readonly string[];
}

export interface SkillInvocationDecisionV1 {
	readonly schema: typeof SKILL_INVOCATION_DECISION_SCHEMA;
	readonly request: SkillInvocationRequestV1;
	readonly decision: SkillInvocationPolicyDecision;
	readonly reason: string;
	readonly capabilityDecisions: readonly SkillInvocationCapabilityDecision[];
	readonly engineBindings: SkillEngineBindingEnvelope;
	readonly requiresRuntimeDispatch: boolean;
	readonly executed: false;
}

export interface SkillInvocationEngineCallEvidence {
	readonly engineBinding: string;
	readonly capability: string;
	readonly providerId: string;
	readonly operation: string;
	readonly ok: boolean;
	readonly durationMs: number;
	readonly error?: string;
}

export interface SkillInvocationOutputPayload {
	readonly format: SkillIoFormat;
	readonly body: string;
}

export interface SkillInvocationReceiptOptions {
	readonly status: SkillInvocationExecutionStatus;
	readonly engineCalls: readonly SkillInvocationEngineCallEvidence[];
	readonly output?: SkillInvocationOutputPayload;
	readonly error?: string;
	readonly completedAt?: string;
}

export interface SkillInvocationReceiptV1 {
	readonly schema: typeof SKILL_INVOCATION_RECEIPT_SCHEMA;
	readonly decision: SkillInvocationDecisionV1;
	readonly status: SkillInvocationExecutionStatus;
	readonly engineCalls: readonly SkillInvocationEngineCallEvidence[];
	readonly output?: SkillInvocationOutputPayload;
	readonly error?: string;
	readonly completedAt: string;
	readonly executed: true;
}

export interface SkillSurfaceDeclarationOptions {
	readonly assetPath: string;
	readonly id?: string;
	readonly includeOptionalCapabilities?: boolean;
}

export interface SkillSurfaceDeclarationV1 {
	readonly layer: "pi";
	readonly kind: "skill";
	readonly id: string;
	readonly assets: readonly string[];
	readonly capabilities: readonly string[];
}

export type SkillActivationPreflightState = "ready" | "blocked";

export interface SkillActivationInstallEvidence {
	readonly pluginManifestValid: boolean;
	readonly integrityVerified: boolean;
	readonly policyAccepted: boolean;
}

export interface SkillActivationPreflightOptions {
	readonly approvedCapabilities: readonly string[];
	readonly availableEngineBindings: readonly string[];
	readonly install: SkillActivationInstallEvidence;
}

export interface SkillActivationPreflightV1 {
	readonly schema: typeof SKILL_ACTIVATION_PREFLIGHT_SCHEMA;
	readonly skill: SkillInvocationPlanSkillRef;
	readonly surface: SkillSurfaceDeclarationV1;
	readonly install: SkillActivationInstallEvidence;
	readonly approvedCapabilities: readonly string[];
	readonly availableEngineBindings: readonly string[];
	readonly state: SkillActivationPreflightState;
	readonly readyForRuntimeDispatch: boolean;
	readonly issues: readonly SkillManifestIssue[];
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

export interface SkillSourceVerificationResult extends SkillManifestValidationResult {
	readonly actual: SkillSourceRef;
}

export interface SkillSourceIntegrityEvidenceV1 {
	readonly schema: typeof SKILL_SOURCE_INTEGRITY_SCHEMA;
	readonly source: SkillSourceRef;
	readonly assetPath: string;
	readonly verified: boolean;
	readonly issues: readonly SkillManifestIssue[];
}

export interface SkillInvocationPlanBuildResult extends SkillManifestValidationResult {
	readonly plan: SkillInvocationPlanV1 | null;
}

export interface SkillInvocationRequestBuildResult extends SkillManifestValidationResult {
	readonly request: SkillInvocationRequestV1 | null;
}

export interface SkillInvocationDecisionBuildResult extends SkillManifestValidationResult {
	readonly decision: SkillInvocationDecisionV1 | null;
}

export interface SkillInvocationReceiptBuildResult extends SkillManifestValidationResult {
	readonly receipt: SkillInvocationReceiptV1 | null;
}

export interface SkillSurfaceDeclarationBuildResult extends SkillManifestValidationResult {
	readonly surface: SkillSurfaceDeclarationV1 | null;
}

export interface SkillActivationPreflightBuildResult extends SkillManifestValidationResult {
	readonly preflight: SkillActivationPreflightV1 | null;
}

export interface SkillSourceIntegrityBuildResult extends SkillManifestValidationResult {
	readonly evidence: SkillSourceIntegrityEvidenceV1 | null;
}

export interface SkillInvocationPlanPrepareResult extends SkillManifestValidationResult {
	readonly manifest: SkillManifestV1 | null;
	readonly plan: SkillInvocationPlanV1 | null;
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
	verifySource(
		source: string,
		expected: SkillSourceRef,
		options?: SkillManifestParseOptions,
	): SkillSourceVerificationResult | Promise<SkillSourceVerificationResult>;
	buildSourceIntegrityEvidence(
		source: string,
		manifest: SkillManifestV1,
		surface: SkillSurfaceDeclarationV1,
		options?: SkillManifestParseOptions,
	): SkillSourceIntegrityBuildResult | Promise<SkillSourceIntegrityBuildResult>;
	buildInvocationPlan(
		manifest: SkillManifestV1,
	): SkillInvocationPlanBuildResult | Promise<SkillInvocationPlanBuildResult>;
	buildInvocationRequest(
		plan: SkillInvocationPlanV1,
		input: string,
	): SkillInvocationRequestBuildResult | Promise<SkillInvocationRequestBuildResult>;
	buildInvocationDecision(
		request: SkillInvocationRequestV1,
		options: SkillInvocationDecisionOptions,
	): SkillInvocationDecisionBuildResult | Promise<SkillInvocationDecisionBuildResult>;
	buildSurfaceDeclaration(
		manifest: SkillManifestV1,
		options: SkillSurfaceDeclarationOptions,
	): SkillSurfaceDeclarationBuildResult | Promise<SkillSurfaceDeclarationBuildResult>;
	evaluateActivationPreflight(
		manifest: SkillManifestV1,
		surface: SkillSurfaceDeclarationV1,
		options: SkillActivationPreflightOptions,
	): SkillActivationPreflightBuildResult | Promise<SkillActivationPreflightBuildResult>;
	prepareInvocationPlan(
		source: string,
		options?: SkillManifestParseOptions,
	): SkillInvocationPlanPrepareResult | Promise<SkillInvocationPlanPrepareResult>;
}
