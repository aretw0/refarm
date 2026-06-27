export interface ReleasePolicyPhase {
	id: string;
	name: string;
	commands: string[];
	required: boolean;
	riskWeight: number;
}

export interface ReleasePolicyProvider {
	id: string;
	type: string;
	supportsPublish: boolean;
	supportsDryRun: boolean;
	publishCommands?: string[];
	publishDryRunCommands?: string[];
	publishRequiresManualApproval?: boolean;
}

export interface ReleasePackageProfile {
	id: string;
	risk?: string;
	bump?: "patch" | "minor" | "major";
	tags?: string[];
	mustPassChecks?: string[];
}

export interface ReleasePolicy {
	policyVersion: string;
	mode: "changeset" | "tagged" | "hybrid";
	providers: ReleasePolicyProvider[];
	defaultSelection?: string;
	selections?: ReleasePolicySelection[];
	packageProfiles?: ReleasePackageProfile[];
	phases: ReleasePolicyPhase[];
	notes?: string[];
}

export declare class ReleasePolicyValidationError extends Error {
	name: "ReleasePolicyValidationError";
	code: string;
	details: Record<string, unknown>;
	constructor(code: string, message: string, details?: Record<string, unknown>);
}

export interface ReleasePolicySelection {
	id: string;
	description?: string;
	profileTags: string[];
}

export interface ReleasePlanPackage {
	name: string;
	bump: "patch" | "minor" | "major";
	source: string;
	status: "ok";
	profile?: ReleasePackageProfile;
	packageDir: string;
	currentVersion: string;
	planOrder: number;
}

export interface ReleasePlanBlocker {
	name: string;
	bump?: "patch" | "minor" | "major";
	source?: string;
	status: "missing" | "blocked" | string;
	note?: string;
}

export interface ReleasePublishIntent {
	provider: string;
	type?: string;
	plan: {
		mode: ReleasePolicy["mode"];
		commands: string[];
		dryRunCommands: string[];
		requiresManualApproval: boolean;
	};
}

export interface ReleasePlan {
	ok: boolean;
	status: "ready" | "blocked" | string;
	policy: ReleasePolicy;
	blockers: ReleasePlanBlocker[];
	orderedPackages: ReleasePlanPackage[];
	orderedNames: string[];
	gates: ReleasePolicyPhase[];
	publishIntents?: ReleasePublishIntent[];
	profileTags?: string[];
	selection?: {
		id: string;
		description: string | null;
	} | null;
	dryRun: boolean;
	releaseNotes: string;
}

export interface ReleaseGateCommandResult {
	command: string;
	status: "passed" | "failed" | "skipped";
	stdout: string;
	stderr: string;
	code: number;
	signal?: NodeJS.Signals | null;
	dryRun?: boolean;
	phase?: string;
	phaseName?: string;
}

export interface ReleaseGateResult {
	ok: boolean;
	results: ReleaseGateCommandResult[];
	policy: ReleasePolicy;
	dryRun: boolean;
	blockedBy?: ReleasePolicyPhase;
	phase?: string;
	command?: string;
}

export interface ReleasePlanSummary {
	status: ReleasePlan["status"];
	packageCount: number;
	packages: string[];
	blockers: ReleasePlanBlocker[];
	packageProfiles: Array<{
		id: string;
		risk: string | null;
		tags: string[];
		mustPassChecks: string[];
	}>;
	requiredGates: string[];
	providers: string[];
	profileTags: string[];
	selection: ReleasePlan["selection"];
	ok: boolean;
	dryRun: boolean;
}

export interface ReleasePlanAuditRecord {
	schemaVersion: 1;
	createdAt: string;
	digest: {
		algorithm: "sha256";
		value: string;
	};
	payload: {
		schemaVersion: 1;
		releaseOutputSchemaVersion: 1;
		ok: boolean;
		status: ReleasePlan["status"];
		policyVersion: string | null;
		mode: ReleasePolicy["mode"] | null;
		packageCount: number;
		packages: string[];
		blockers: ReleasePlanBlocker[];
		packageProfiles: ReleasePlanSummary["packageProfiles"];
		requiredGates: string[];
		gates: Array<{
			id: string;
			required: boolean;
			riskWeight: number;
			commandCount: number;
		}>;
		publishIntents: Array<{
			provider: string;
			type: string | null;
			mode: ReleasePolicy["mode"] | null;
			commandCount: number;
			dryRunCommandCount: number;
			requiresManualApproval: boolean;
		}>;
		profileTags: string[];
		selection: ReleasePlan["selection"];
		dryRun: boolean;
	};
}

export declare const DEFAULT_POLICY_VERSION: string;
export declare const SUPPORTED_POLICY_VERSIONS: readonly string[];
export declare const RELEASE_ENGINE_JSON_SCHEMA_VERSION: 1;
export declare const RELEASE_PLAN_AUDIT_SCHEMA_VERSION: 1;

export function loadPolicy(policyPath?: string, cwd?: string): ReleasePolicy;
export function validatePolicy(policy: ReleasePolicy): true;
export function buildReleasePlan(options?: {
	cwd?: string;
	policyPath?: string;
	packageNames?: string[];
	profileTags?: string[];
	selectionId?: string;
	dryRun?: boolean;
}): ReleasePlan;
export function runCommand(command: string, options?: {
	cwd?: string;
	dryRun?: boolean;
}): ReleaseGateCommandResult;
export function runReleaseGates(plan: ReleasePlan, options?: {
	cwd?: string;
	dryRun?: boolean;
	onlyRequired?: boolean;
}): ReleaseGateResult;
export function formatPlan(plan: ReleasePlan): string;
export function summarizePlan(plan: ReleasePlan): ReleasePlanSummary;
export function stringifyReleasePlanAuditPayload(payload: unknown): string;
export function createReleasePlanAuditRecord(
	plan: ReleasePlan,
	options?: { createdAt?: string },
): ReleasePlanAuditRecord;
export function resolvePolicySelection(
	policy: ReleasePolicy,
	selectionId?: string,
): ReleasePolicySelection | null;
export function releasePlanPackageProfiles(
	plan: ReleasePlan,
): ReleasePlanSummary["packageProfiles"];
