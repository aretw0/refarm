export const WORKER_PROFILE_SCHEMA_VERSION = 1 as const;
export const WORKER_TOOL_SCHEMA_VERSION = 1 as const;
export const WORKER_TOOL_RESULT_SCHEMA_VERSION = 1 as const;
export const WORKER_PROFILE_MAX_PARALLEL = 4 as const;
export const WORKER_TOOL_MAX_TURNS = 8 as const;

export type WorkerModelScope = "default" | "worker" | "monitor";
export type WorkerResumePolicy = "continue" | "restart" | "manual";
export type WorkerOutputFormat = "summary" | "json";
export type WorkerToolExecutionMode = "plan-only" | "runtime-dispatch";
export type WorkerToolReadinessState = "ready" | "blocked";
export type WorkerToolResultStatus =
	| "completed"
	| "blocked"
	| "failed"
	| "cancelled";
export type WorkerToolReadinessRequirement =
	| "policy"
	| "cancellation"
	| "observability"
	| "cost-control";

export interface WorkerToolReadinessBlocker {
	code: string;
	requirement: WorkerToolReadinessRequirement;
	description: string;
}

export interface WorkerContextPacket {
	objective: string;
	instructions: readonly string[];
	inputs: readonly string[];
}

export interface WorkerModelRoute {
	scope: WorkerModelScope;
	ref?: string;
}

export interface WorkerToolPolicy {
	allowed: readonly string[];
	denied?: readonly string[];
}

export interface WorkerConcurrencyPolicy {
	maxParallel: number;
}

export interface WorkerOutputContract {
	format: WorkerOutputFormat;
	requiredFields: readonly string[];
}

export interface WorkerLifecyclePolicy {
	resume: WorkerResumePolicy;
	cancellable: boolean;
}

export interface WorkerProfile {
	schemaVersion: typeof WORKER_PROFILE_SCHEMA_VERSION;
	id: string;
	title: string;
	description: string;
	context: WorkerContextPacket;
	tools: WorkerToolPolicy;
	model: WorkerModelRoute;
	concurrency: WorkerConcurrencyPolicy;
	output: WorkerOutputContract;
	lifecycle: WorkerLifecyclePolicy;
}

export interface WorkerToolBudget {
	maxTurns: number;
	maxParallel: number;
}

export interface WorkerToolInvocation {
	mode: WorkerToolExecutionMode;
	model: WorkerModelRoute;
	tokenUse: "provider";
}

export interface WorkerToolDescriptor {
	schemaVersion: typeof WORKER_TOOL_SCHEMA_VERSION;
	name: string;
	title: string;
	description: string;
	profile: WorkerProfile;
	budget: WorkerToolBudget;
	invocation: WorkerToolInvocation;
	inputFields: readonly string[];
	outputFields: readonly string[];
}

export interface WorkerToolReadiness {
	ok: boolean;
	state: WorkerToolReadinessState;
	requestedMode: WorkerToolExecutionMode;
	supportedMode: "plan-only";
	issues: readonly string[];
	blockers: readonly WorkerToolReadinessBlocker[];
}

export interface WorkerToolResult {
	schemaVersion: typeof WORKER_TOOL_RESULT_SCHEMA_VERSION;
	descriptorName: string;
	profileId: string;
	status: WorkerToolResultStatus;
	summary: string;
	output: Record<string, unknown>;
	handoffs: readonly string[];
	issues: readonly string[];
}

export interface WorkerProfileInput {
	id: string;
	title: string;
	description: string;
	objective: string;
	instructions?: readonly string[];
	inputs?: readonly string[];
	allowedTools?: readonly string[];
	deniedTools?: readonly string[];
	model?: Partial<WorkerModelRoute>;
	maxParallel?: number;
	output?: Partial<WorkerOutputContract>;
	lifecycle?: Partial<WorkerLifecyclePolicy>;
}

export interface WorkerProfileValidation {
	ok: boolean;
	issues: string[];
}

export interface WorkerToolDescriptorInput {
	name?: string;
	title?: string;
	description?: string;
	mode?: WorkerToolExecutionMode;
	maxTurns?: number;
	maxParallel?: number;
	inputFields?: readonly string[];
}

export interface WorkerToolResultInput {
	status?: WorkerToolResultStatus;
	summary: string;
	output?: Record<string, unknown>;
	handoffs?: readonly string[];
	issues?: readonly string[];
}

export const WORKER_TOOL_RUNTIME_DISPATCH_BLOCKERS = [
	{
		code: "runtime-dispatch.policy-proof-missing",
		requirement: "policy",
		description:
			"Worker dispatch needs an executable policy proof for tool access, filesystem scope, and model route.",
	},
	{
		code: "runtime-dispatch.cancellation-proof-missing",
		requirement: "cancellation",
		description:
			"Worker dispatch needs a cancellation and resume proof before work can fan out.",
	},
	{
		code: "runtime-dispatch.observability-proof-missing",
		requirement: "observability",
		description:
			"Worker dispatch needs stream, session, and task handoffs for operator inspection.",
	},
	{
		code: "runtime-dispatch.cost-control-proof-missing",
		requirement: "cost-control",
		description:
			"Worker dispatch needs budget accounting for provider token use and bounded turns.",
	},
] as const satisfies readonly WorkerToolReadinessBlocker[];

export function createWorkerProfile(
	input: WorkerProfileInput,
): WorkerProfile {
	return {
		schemaVersion: WORKER_PROFILE_SCHEMA_VERSION,
		id: input.id,
		title: input.title,
		description: input.description,
		context: {
			objective: input.objective,
			instructions: input.instructions ?? [],
			inputs: input.inputs ?? [],
		},
		tools: {
			allowed: input.allowedTools ?? [],
			...(input.deniedTools ? { denied: input.deniedTools } : {}),
		},
		model: {
			scope: input.model?.scope ?? "worker",
			...(input.model?.ref ? { ref: input.model.ref } : {}),
		},
		concurrency: {
			maxParallel: input.maxParallel ?? 1,
		},
		output: {
			format: input.output?.format ?? "summary",
			requiredFields: input.output?.requiredFields ?? ["summary"],
		},
		lifecycle: {
			resume: input.lifecycle?.resume ?? "manual",
			cancellable: input.lifecycle?.cancellable ?? true,
		},
	};
}

export function validateWorkerProfile(
	profile: WorkerProfile,
): WorkerProfileValidation {
	const issues: string[] = [];
	if (profile.schemaVersion !== WORKER_PROFILE_SCHEMA_VERSION) {
		issues.push("schemaVersion must be 1");
	}
	if (!nonEmpty(profile.id)) issues.push("id is required");
	if (!nonEmpty(profile.title)) issues.push("title is required");
	if (!nonEmpty(profile.description)) issues.push("description is required");
	if (!nonEmpty(profile.context.objective)) {
		issues.push("context.objective is required");
	}
	if (profile.tools.allowed.length === 0) {
		issues.push("tools.allowed must list at least one tool");
	}
	if (
		!Number.isInteger(profile.concurrency.maxParallel) ||
		profile.concurrency.maxParallel < 1 ||
		profile.concurrency.maxParallel > WORKER_PROFILE_MAX_PARALLEL
	) {
		issues.push(
			`concurrency.maxParallel must be between 1 and ${WORKER_PROFILE_MAX_PARALLEL}`,
		);
	}
	if (!["default", "worker", "monitor"].includes(profile.model.scope)) {
		issues.push("model.scope must be default, worker, or monitor");
	}
	if (!["summary", "json"].includes(profile.output.format)) {
		issues.push("output.format must be summary or json");
	}
	if (profile.output.requiredFields.length === 0) {
		issues.push("output.requiredFields must list at least one field");
	}
	if (!["continue", "restart", "manual"].includes(profile.lifecycle.resume)) {
		issues.push("lifecycle.resume must be continue, restart, or manual");
	}
	return { ok: issues.length === 0, issues };
}

export function createWorkerToolDescriptor(
	profile: WorkerProfile,
	input: WorkerToolDescriptorInput = {},
): WorkerToolDescriptor {
	return {
		schemaVersion: WORKER_TOOL_SCHEMA_VERSION,
		name: input.name ?? profile.id,
		title: input.title ?? profile.title,
		description: input.description ?? profile.description,
		profile,
		budget: {
			maxTurns: input.maxTurns ?? 1,
			maxParallel: input.maxParallel ?? profile.concurrency.maxParallel,
		},
		invocation: {
			mode: input.mode ?? "plan-only",
			model: profile.model,
			tokenUse: "provider",
		},
		inputFields: input.inputFields ?? ["task"],
		outputFields: profile.output.requiredFields,
	};
}

export function validateWorkerToolDescriptor(
	descriptor: WorkerToolDescriptor,
): WorkerProfileValidation {
	const issues: string[] = [];
	if (descriptor.schemaVersion !== WORKER_TOOL_SCHEMA_VERSION) {
		issues.push("schemaVersion must be 1");
	}
	if (!nonEmpty(descriptor.name)) issues.push("name is required");
	if (!nonEmpty(descriptor.title)) issues.push("title is required");
	if (!nonEmpty(descriptor.description)) issues.push("description is required");

	const profileValidation = validateWorkerProfile(descriptor.profile);
	for (const issue of profileValidation.issues) {
		issues.push(`profile.${issue}`);
	}

	if (descriptor.invocation.mode !== "plan-only") {
		issues.push("invocation.mode must be plan-only until runtime dispatch is implemented");
	}
	if (descriptor.invocation.tokenUse !== "provider") {
		issues.push("invocation.tokenUse must be provider");
	}
	if (!["default", "worker", "monitor"].includes(descriptor.invocation.model.scope)) {
		issues.push("invocation.model.scope must be default, worker, or monitor");
	}
	if (
		!Number.isInteger(descriptor.budget.maxTurns) ||
		descriptor.budget.maxTurns < 1 ||
		descriptor.budget.maxTurns > WORKER_TOOL_MAX_TURNS
	) {
		issues.push(`budget.maxTurns must be between 1 and ${WORKER_TOOL_MAX_TURNS}`);
	}
	if (
		!Number.isInteger(descriptor.budget.maxParallel) ||
		descriptor.budget.maxParallel < 1 ||
		descriptor.budget.maxParallel > descriptor.profile.concurrency.maxParallel
	) {
		issues.push("budget.maxParallel must be between 1 and profile.concurrency.maxParallel");
	}
	if (descriptor.inputFields.length === 0) {
		issues.push("inputFields must list at least one field");
	}
	if (descriptor.outputFields.length === 0) {
		issues.push("outputFields must list at least one field");
	}

	return { ok: issues.length === 0, issues };
}

export function assessWorkerToolReadiness(
	descriptor: WorkerToolDescriptor,
): WorkerToolReadiness {
	const validation = validateWorkerToolDescriptor(descriptor);
	const blockers: WorkerToolReadinessBlocker[] = [];

	if (!validation.ok) {
		blockers.push({
			code: "descriptor.validation-failed",
			requirement: "policy",
			description:
				"Worker tool descriptor must pass validation before it can be offered to another runtime.",
		});
	}

	if (descriptor.invocation.mode === "runtime-dispatch") {
		blockers.push(...WORKER_TOOL_RUNTIME_DISPATCH_BLOCKERS);
	}

	return {
		ok: validation.ok && blockers.length === 0,
		state: blockers.length === 0 ? "ready" : "blocked",
		requestedMode: descriptor.invocation.mode,
		supportedMode: "plan-only",
		issues: validation.issues,
		blockers,
	};
}

export function createWorkerToolResult(
	descriptor: WorkerToolDescriptor,
	input: WorkerToolResultInput,
): WorkerToolResult {
	return {
		schemaVersion: WORKER_TOOL_RESULT_SCHEMA_VERSION,
		descriptorName: descriptor.name,
		profileId: descriptor.profile.id,
		status: input.status ?? "completed",
		summary: input.summary,
		output: input.output ?? {},
		handoffs: input.handoffs ?? [],
		issues: input.issues ?? [],
	};
}

export function validateWorkerToolResult(
	descriptor: WorkerToolDescriptor,
	result: WorkerToolResult,
): WorkerProfileValidation {
	const issues: string[] = [];
	if (result.schemaVersion !== WORKER_TOOL_RESULT_SCHEMA_VERSION) {
		issues.push("schemaVersion must be 1");
	}
	if (result.descriptorName !== descriptor.name) {
		issues.push("descriptorName must match descriptor.name");
	}
	if (result.profileId !== descriptor.profile.id) {
		issues.push("profileId must match descriptor.profile.id");
	}
	if (!["completed", "blocked", "failed", "cancelled"].includes(result.status)) {
		issues.push("status must be completed, blocked, failed, or cancelled");
	}
	if (!nonEmpty(result.summary)) issues.push("summary is required");

	if (result.status === "completed") {
		for (const field of descriptor.outputFields) {
			if (!(field in result.output)) {
				issues.push(`output.${field} is required for completed results`);
			}
		}
	}

	if (result.status !== "completed" && result.issues.length === 0) {
		issues.push("issues must explain non-completed results");
	}

	return { ok: issues.length === 0, issues };
}

function nonEmpty(value: string): boolean {
	return value.trim().length > 0;
}
