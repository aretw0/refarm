export interface ExecutionPlanBase<
	Action extends string,
	Effects extends Record<string, unknown>,
	Substrate extends { kind: string },
> {
	action: Action;
	destructive: boolean;
	readyToExecute: boolean;
	blockedReason?: string;
	recommendedCommand: string | null;
	effects: Effects;
	substrate: Substrate;
}

export interface ExecutionPlanReadinessInput {
	readyToExecute: boolean;
	blockedReason?: string;
}

export interface ExecutionPlanReadinessLine {
	status: "blocked" | "ready";
	label: string;
}

export interface ExecutionPlanHandoff {
	nextAction: string | null;
	nextActions: string[];
	nextCommand: string | null;
	nextCommands: string[];
	templates: Array<{
		id: string;
		command: string;
		parameters: string[];
		useWhen: string;
	}>;
}

export interface ExecutionPlanHandoffInput
	extends Pick<
		ExecutionPlanBase<string, Record<string, unknown>, { kind: string }>,
		"readyToExecute" | "blockedReason" | "recommendedCommand"
	> {
	commandTemplate?: string;
}

export type RefarmExecutionPlanBase<
	Action extends string,
	Effects extends Record<string, unknown>,
	Substrate extends { kind: string },
> = ExecutionPlanBase<Action, Effects, Substrate>;
export type RefarmExecutionPlanReadinessInput = ExecutionPlanReadinessInput;
export type RefarmExecutionPlanReadinessLine = ExecutionPlanReadinessLine;
export type RefarmExecutionPlanHandoff = ExecutionPlanHandoff;
export type RefarmExecutionPlanHandoffInput = ExecutionPlanHandoffInput;

function commandTemplateParameters(command: string): string[] {
	return [...command.matchAll(/<([^>]+)>/g)].map((match) => match[1]!);
}

export function formatExecutionPlanReadinessLine(
	plan: ExecutionPlanReadinessInput,
): ExecutionPlanReadinessLine {
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
	plan: ExecutionPlanHandoffInput,
): ExecutionPlanHandoff {
	const command = plan.recommendedCommand ?? null;
	const templateCommand = plan.commandTemplate ?? command;
	const nextAction = plan.readyToExecute
		? command
		: plan.blockedReason ?? command;
	const nextCommands = plan.readyToExecute && command ? [command] : [];
	const parameters = templateCommand ? commandTemplateParameters(templateCommand) : [];
	return {
		nextAction,
		nextActions: nextAction ? [nextAction] : [],
		nextCommand: nextCommands[0] ?? null,
		nextCommands,
		templates:
			parameters.length > 0
				? [
						{
							id: "execution-plan-command",
							command: templateCommand!,
							parameters,
							useWhen:
								plan.blockedReason ??
								"After substituting concrete parameters for the execution plan command.",
						},
					]
				: [],
	};
}
