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

export interface RefarmExecutionPlanHandoff {
	nextAction: string | null;
	nextActions: string[];
	nextCommand: string | null;
	nextCommands: string[];
}

export type RefarmExecutionPlanHandoffInput = Pick<
	RefarmExecutionPlanBase<string, Record<string, unknown>, { kind: string }>,
	"readyToExecute" | "blockedReason" | "recommendedCommand"
>;

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

export function createExecutionPlanHandoff(
	plan: RefarmExecutionPlanHandoffInput,
): RefarmExecutionPlanHandoff {
	const nextAction = plan.readyToExecute
		? plan.recommendedCommand
		: plan.blockedReason ?? plan.recommendedCommand;
	const nextCommands = plan.readyToExecute ? [plan.recommendedCommand] : [];
	return {
		nextAction,
		nextActions: nextAction ? [nextAction] : [],
		nextCommand: nextCommands[0] ?? null,
		nextCommands,
	};
}
