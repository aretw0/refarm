export const INTERACTION_DRIVER_SCHEMA_VERSION = 1 as const;
export const INTERACTION_DRIVER_MIN_REQUIRED_EVENTS = [
	"accepted",
	"streamed",
	"completed",
] as const;

export type InteractionDriverMode = "local-loop" | "gateway-rpc";
export type InteractionDriverReadinessState = "ready" | "blocked";
export type InteractionDriverReadinessRequirement =
	| "lifecycle"
	| "steering"
	| "gateway"
	| "budget";

export interface InteractionDriverReadinessBlocker {
	code: string;
	requirement: InteractionDriverReadinessRequirement;
	description: string;
	proofTarget: string;
}

export interface InteractionDriverEventContract {
	format: "json-events";
	requiredEvents: readonly string[];
}

export interface InteractionDriverHandoffContract {
	resume: boolean;
	session: boolean;
	task: boolean;
}

export interface InteractionDriverBudgetVisibility {
	modelRoute: boolean;
	tokenUse: boolean;
	retries: boolean;
	stopCondition: boolean;
}

export interface InteractionDriverDescriptor {
	schemaVersion: typeof INTERACTION_DRIVER_SCHEMA_VERSION;
	id: string;
	title: string;
	description: string;
	mode: InteractionDriverMode;
	eventContract: InteractionDriverEventContract;
	handoffs: InteractionDriverHandoffContract;
	budget: InteractionDriverBudgetVisibility;
}

export interface InteractionDriverDescriptorInput {
	id: string;
	title: string;
	description: string;
	mode?: InteractionDriverMode;
	requiredEvents?: readonly string[];
	handoffs?: Partial<InteractionDriverHandoffContract>;
	budget?: Partial<InteractionDriverBudgetVisibility>;
}

export interface InteractionDriverValidation {
	ok: boolean;
	issues: string[];
}

export interface InteractionDriverReadiness {
	ok: boolean;
	state: InteractionDriverReadinessState;
	requestedMode: InteractionDriverMode;
	supportedMode: "local-loop";
	issues: readonly string[];
	blockers: readonly InteractionDriverReadinessBlocker[];
}

export const INTERACTION_DRIVER_GATEWAY_BLOCKERS = [
	{
		code: "gateway.lifecycle-proof-missing",
		requirement: "lifecycle",
		description:
			"Gateway promotion needs prompt acceptance, streaming, abort, resume, and terminal events through one stable event contract.",
		proofTarget:
			"interaction lifecycle: prompt accepted, streamed, aborted, resumed, and reported through stable JSON events",
	},
	{
		code: "gateway.steering-proof-missing",
		requirement: "steering",
		description:
			"Gateway promotion needs follow-up and redirect semantics that persist into handoffs.",
		proofTarget:
			"operator steering: follow-up and redirect queue semantics persist into session/task handoffs",
	},
	{
		code: "gateway.parity-proof-missing",
		requirement: "gateway",
		description:
			"Gateway promotion needs CLI, app, and future RPC or messaging surfaces to share one interaction contract.",
		proofTarget:
			"gateway parity: CLI, app, and future RPC/messaging surfaces share the same ask contract",
	},
	{
		code: "gateway.budget-proof-missing",
		requirement: "budget",
		description:
			"Gateway promotion needs model route, token or cost use, retries, and stop conditions in operator handoffs.",
		proofTarget:
			"budget visibility: model route, token/cost use, retries, and stop conditions are visible in resume/check handoffs",
	},
] as const satisfies readonly InteractionDriverReadinessBlocker[];

export function createInteractionDriverDescriptor(
	input: InteractionDriverDescriptorInput,
): InteractionDriverDescriptor {
	return {
		schemaVersion: INTERACTION_DRIVER_SCHEMA_VERSION,
		id: input.id,
		title: input.title,
		description: input.description,
		mode: input.mode ?? "local-loop",
		eventContract: {
			format: "json-events",
			requiredEvents:
				input.requiredEvents ?? INTERACTION_DRIVER_MIN_REQUIRED_EVENTS,
		},
		handoffs: {
			resume: input.handoffs?.resume ?? true,
			session: input.handoffs?.session ?? true,
			task: input.handoffs?.task ?? true,
		},
		budget: {
			modelRoute: input.budget?.modelRoute ?? true,
			tokenUse: input.budget?.tokenUse ?? false,
			retries: input.budget?.retries ?? false,
			stopCondition: input.budget?.stopCondition ?? false,
		},
	};
}

export function validateInteractionDriverDescriptor(
	descriptor: InteractionDriverDescriptor,
): InteractionDriverValidation {
	const issues: string[] = [];
	if (descriptor.schemaVersion !== INTERACTION_DRIVER_SCHEMA_VERSION) {
		issues.push("schemaVersion must be 1");
	}
	if (!nonEmpty(descriptor.id)) issues.push("id is required");
	if (!nonEmpty(descriptor.title)) issues.push("title is required");
	if (!nonEmpty(descriptor.description)) issues.push("description is required");
	if (!["local-loop", "gateway-rpc"].includes(descriptor.mode)) {
		issues.push("mode must be local-loop or gateway-rpc");
	}
	if (descriptor.eventContract.format !== "json-events") {
		issues.push("eventContract.format must be json-events");
	}
	for (const eventName of INTERACTION_DRIVER_MIN_REQUIRED_EVENTS) {
		if (!descriptor.eventContract.requiredEvents.includes(eventName)) {
			issues.push(`eventContract.requiredEvents must include ${eventName}`);
		}
	}
	if (!descriptor.handoffs.resume) issues.push("handoffs.resume must be true");
	if (!descriptor.handoffs.session) issues.push("handoffs.session must be true");
	if (!descriptor.handoffs.task) issues.push("handoffs.task must be true");
	if (!descriptor.budget.modelRoute) {
		issues.push("budget.modelRoute must be true");
	}
	return { ok: issues.length === 0, issues };
}

export function assessInteractionDriverReadiness(
	descriptor: InteractionDriverDescriptor,
): InteractionDriverReadiness {
	const validation = validateInteractionDriverDescriptor(descriptor);
	const blockers: InteractionDriverReadinessBlocker[] = [];

	if (!validation.ok) {
		blockers.push({
			code: "descriptor.validation-failed",
			requirement: "lifecycle",
			description:
				"Interaction driver descriptor must pass validation before it can be exposed as a reference-driver contract.",
			proofTarget:
				"descriptor contract: valid interaction id, JSON event contract, resume/session/task handoffs, and model route visibility",
		});
	}

	if (descriptor.mode === "gateway-rpc") {
		blockers.push(...INTERACTION_DRIVER_GATEWAY_BLOCKERS);
	}

	return {
		ok: validation.ok && blockers.length === 0,
		state: blockers.length === 0 ? "ready" : "blocked",
		requestedMode: descriptor.mode,
		supportedMode: "local-loop",
		issues: validation.issues,
		blockers,
	};
}

function nonEmpty(value: string): boolean {
	return value.trim().length > 0;
}
