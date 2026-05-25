import {
	commandPayloadNextActions,
	commandPayloadNextCommands,
	commandPayloadOk,
	commandPayloadRecommendations,
} from "./command-result.js";
import {
	buildJsonSuccessEnvelope,
	type JsonSuccessEnvelope,
} from "./json-output.js";

export interface CommandPlanStep {
	id: string;
	command: string;
	args: string[];
	description: string;
	effect?: "observe" | "verify" | "write";
}

export type CommandPlanEffect = NonNullable<CommandPlanStep["effect"]>;

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
	failedStepId: string | null;
	failedCommand: string | null;
	nextActions: string[];
	nextCommands: string[];
	recommendations: unknown[];
}

export interface CommandPlanStepSummary {
	id: string;
	command: string;
	ok: boolean;
	exitCode: number;
	effect?: CommandPlanEffect;
	payload?: unknown;
}

export interface CommandPlanEnvelopeContext {
	action: string;
	command: string;
	operation: string;
}

export interface CommandPlanEnvelopeExtra {
	action: string;
	status: "plan";
	effects: CommandPlanEffect[];
	writes: boolean;
	steps: readonly CommandPlanStep[];
}

export type CommandPlanEnvelope =
	JsonSuccessEnvelope<CommandPlanEnvelopeExtra>;

export interface CommandPlanRunEnvelope {
	action: string;
	status: CommandPlanRunResult["status"];
	effects: CommandPlanEffect[];
	writes: boolean;
	steps: CommandPlanStepRunResult[];
	stepResults: CommandPlanStepSummary[];
	failedStepId: string | null;
	failedCommand: string | null;
	command: string;
	operation: string;
	ok: boolean;
	nextAction: string | null;
	nextActions: string[];
	nextCommand: string | null;
	nextCommands: string[];
	recommendations: unknown[];
}

export function commandPlanStepCommands(
	steps: readonly CommandPlanStep[],
): string[] {
	return steps.map((step) => step.command);
}

export function commandPlanEffects(
	steps: readonly CommandPlanStep[],
): CommandPlanEffect[] {
	return Array.from(
		new Set(
			steps
				.map((step) => step.effect)
				.filter((effect): effect is CommandPlanEffect => Boolean(effect)),
		),
	);
}

export function commandPlanWrites(steps: readonly CommandPlanStep[]): boolean {
	return commandPlanEffects(steps).includes("write");
}

export function buildCommandPlanEnvelope(
	context: CommandPlanEnvelopeContext,
	steps: readonly CommandPlanStep[],
): CommandPlanEnvelope {
	const nextCommands = commandPlanStepCommands(steps);
	const effects = commandPlanEffects(steps);
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
			effects,
			writes: effects.includes("write"),
			steps,
		},
	});
}

export function buildCommandPlanRunEnvelope(
	context: CommandPlanEnvelopeContext,
	result: CommandPlanRunResult,
): CommandPlanRunEnvelope {
	return {
		action: context.action,
		status: result.status,
		effects: commandPlanEffects(result.steps),
		writes: commandPlanWrites(result.steps),
		steps: result.steps,
		stepResults: result.steps.map(commandPlanStepSummary),
		failedStepId: result.failedStepId,
		failedCommand: result.failedCommand,
		command: context.command,
		operation: context.operation,
		ok: result.ok,
		nextAction: result.nextActions[0] ?? result.nextCommands[0] ?? null,
		nextActions: result.nextActions,
		nextCommand: result.nextCommands[0] ?? null,
		nextCommands: result.nextCommands,
		recommendations: result.recommendations,
	};
}

export function commandPlanStepSummary(
	step: CommandPlanStepRunResult,
): CommandPlanStepSummary {
	return {
		id: step.id,
		command: step.command,
		ok: step.ok,
		exitCode: step.exitCode,
		...(step.effect ? { effect: step.effect } : {}),
		...(step.payload !== undefined ? { payload: commandPlanPayloadSummary(step.payload) } : {}),
	};
}

function commandPlanPayloadSummary(payload: unknown): unknown {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return payload;
	}
	const { stdout: _stdout, stderr: _stderr, ...summary } =
		payload as Record<string, unknown>;
	return summary;
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
				failedStepId: step.id,
				failedCommand: step.command,
				nextActions: commandPayloadNextActions(result.payload) ??
					commandPayloadNextCommands(result.payload) ?? [step.command],
				nextCommands:
					commandPayloadNextCommands(result.payload) ?? [step.command],
				recommendations: commandPayloadRecommendations(result.payload) ?? [],
			};
		}
	}
	return {
		ok: true,
		status: "passed",
		steps,
		failedStepId: null,
		failedCommand: null,
		nextActions: [],
		nextCommands: [],
		recommendations: [],
	};
}
