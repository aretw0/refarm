export const REFARM_WORKER_PROFILE_SCHEMA_VERSION = 1 as const;
export const REFARM_WORKER_PROFILE_MAX_PARALLEL = 4 as const;

export type RefarmWorkerModelScope = "default" | "worker" | "monitor";
export type RefarmWorkerResumePolicy = "continue" | "restart" | "manual";
export type RefarmWorkerOutputFormat = "summary" | "json";

export interface RefarmWorkerContextPacket {
	objective: string;
	instructions: readonly string[];
	inputs: readonly string[];
}

export interface RefarmWorkerModelRoute {
	scope: RefarmWorkerModelScope;
	ref?: string;
}

export interface RefarmWorkerToolPolicy {
	allowed: readonly string[];
	denied?: readonly string[];
}

export interface RefarmWorkerConcurrencyPolicy {
	maxParallel: number;
}

export interface RefarmWorkerOutputContract {
	format: RefarmWorkerOutputFormat;
	requiredFields: readonly string[];
}

export interface RefarmWorkerLifecyclePolicy {
	resume: RefarmWorkerResumePolicy;
	cancellable: boolean;
}

export interface RefarmWorkerProfile {
	schemaVersion: typeof REFARM_WORKER_PROFILE_SCHEMA_VERSION;
	id: string;
	title: string;
	description: string;
	context: RefarmWorkerContextPacket;
	tools: RefarmWorkerToolPolicy;
	model: RefarmWorkerModelRoute;
	concurrency: RefarmWorkerConcurrencyPolicy;
	output: RefarmWorkerOutputContract;
	lifecycle: RefarmWorkerLifecyclePolicy;
}

export interface RefarmWorkerProfileInput {
	id: string;
	title: string;
	description: string;
	objective: string;
	instructions?: readonly string[];
	inputs?: readonly string[];
	allowedTools?: readonly string[];
	deniedTools?: readonly string[];
	model?: Partial<RefarmWorkerModelRoute>;
	maxParallel?: number;
	output?: Partial<RefarmWorkerOutputContract>;
	lifecycle?: Partial<RefarmWorkerLifecyclePolicy>;
}

export interface RefarmWorkerProfileValidation {
	ok: boolean;
	issues: string[];
}

export function createRefarmWorkerProfile(
	input: RefarmWorkerProfileInput,
): RefarmWorkerProfile {
	return {
		schemaVersion: REFARM_WORKER_PROFILE_SCHEMA_VERSION,
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

export function validateRefarmWorkerProfile(
	profile: RefarmWorkerProfile,
): RefarmWorkerProfileValidation {
	const issues: string[] = [];
	if (profile.schemaVersion !== REFARM_WORKER_PROFILE_SCHEMA_VERSION) {
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
		profile.concurrency.maxParallel > REFARM_WORKER_PROFILE_MAX_PARALLEL
	) {
		issues.push(
			`concurrency.maxParallel must be between 1 and ${REFARM_WORKER_PROFILE_MAX_PARALLEL}`,
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

function nonEmpty(value: string): boolean {
	return value.trim().length > 0;
}
