import {
	commandPayloadNextActions,
	commandPayloadNextCommands,
	commandPayloadOk,
} from "./command-result.js";

export interface CommandPlanStep {
	id: string;
	command: string;
	args: string[];
	description: string;
}

export interface CommandPlanStepRunResult extends CommandPlanStep {
	ok: boolean;
	exitCode: number;
	stdout: string;
	stderr: string;
	payload?: unknown;
}

export interface CommandPlanRunResult {
	ok: boolean;
	status: "passed" | "failed";
	steps: CommandPlanStepRunResult[];
	nextActions: string[];
	nextCommands: string[];
}

export function runCommandPlan(
	stepsToRun: readonly CommandPlanStep[],
	runStep: (step: CommandPlanStep) => CommandPlanStepRunResult,
): CommandPlanRunResult {
	const steps: CommandPlanStepRunResult[] = [];
	for (const step of stepsToRun) {
		const observed = runStep(step);
		const result = {
			...observed,
			id: step.id,
			command: step.command,
			args: step.args,
			description: step.description,
		};
		const payloadOk = commandPayloadOk(result.payload);
		const ok = result.exitCode === 0 && payloadOk !== false;
		const normalized = { ...result, ok };
		steps.push(normalized);
		if (!ok) {
			return {
				ok: false,
				status: "failed",
				steps,
				nextActions: commandPayloadNextActions(result.payload) ??
					commandPayloadNextCommands(result.payload) ?? [step.command],
				nextCommands:
					commandPayloadNextCommands(result.payload) ?? [step.command],
			};
		}
	}
	return {
		ok: true,
		status: "passed",
		steps,
		nextActions: [],
		nextCommands: [],
	};
}
