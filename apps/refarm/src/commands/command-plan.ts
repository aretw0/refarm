import {
	commandPayloadNextActions,
	commandPayloadNextCommands,
	commandPayloadOk,
} from "./command-result.js";
import { buildJsonSuccessEnvelope } from "./json-output.js";

export interface CommandPlanStep {
	id: string;
	command: string;
	args: string[];
	description: string;
	effect?: "observe" | "verify" | "write";
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

export interface CommandPlanEnvelopeContext {
	action: string;
	command: string;
	operation: string;
}

export function commandPlanStepCommands(
	steps: readonly CommandPlanStep[],
): string[] {
	return steps.map((step) => step.command);
}

export function buildCommandPlanEnvelope(
	context: CommandPlanEnvelopeContext,
	steps: readonly CommandPlanStep[],
): object {
	const nextCommands = commandPlanStepCommands(steps);
	return buildJsonSuccessEnvelope({
		command: context.command,
		operation: context.operation,
		nextAction: nextCommands[0] ?? null,
		nextActions: nextCommands,
		nextCommand: nextCommands[0] ?? null,
		nextCommands,
		extra: {
			action: context.action,
			status: "plan",
			steps,
		},
	});
}

export function buildCommandPlanRunEnvelope(
	context: CommandPlanEnvelopeContext,
	result: CommandPlanRunResult,
): object {
	return {
		action: context.action,
		status: result.status,
		steps: result.steps,
		command: context.command,
		operation: context.operation,
		ok: result.ok,
		nextAction: result.nextActions[0] ?? result.nextCommands[0] ?? null,
		nextActions: result.nextActions,
		nextCommand: result.nextCommands[0] ?? null,
		nextCommands: result.nextCommands,
	};
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
			effect: step.effect,
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
