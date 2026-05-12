export interface RefarmExecutionPlanBase<
	Action extends string,
	Effects extends Record<string, unknown>,
	Substrate extends { kind: string },
> {
	action: Action;
	destructive: boolean;
	readyToExecute: boolean;
	blockedReason?: string;
	recommendedCommand: string;
	effects: Effects;
	substrate: Substrate;
}

export interface RefarmExecutionPlanReadinessInput {
	readyToExecute: boolean;
	blockedReason?: string;
}

export interface RefarmExecutionPlanReadinessLine {
	status: "blocked" | "ready";
	label: string;
}

export function formatExecutionPlanReadinessLine(
	plan: RefarmExecutionPlanReadinessInput,
): RefarmExecutionPlanReadinessLine {
	if (plan.blockedReason) {
		return {
			status: "blocked",
			label: `Blocked: ${plan.blockedReason}`,
		};
	}
	return {
		status: "ready",
		label: `Ready: ${plan.readyToExecute ? "yes" : "no"}`,
	};
}
