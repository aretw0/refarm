import { spawnSync } from "node:child_process";
import {
	normalizeHandoffValues,
	shellCommand,
} from "./command-handoff.js";
import {
	commandPayloadNextActions,
	commandPayloadNextCommands,
	commandPayloadOk,
	commandPayloadRecommendations,
	parseCommandJsonPayload,
} from "./command-result.js";
import {
	buildJsonSuccessEnvelope,
	type JsonSuccessEnvelope,
} from "./json-output.js";

export interface CommandProcessSpec {
	command: string;
	args: string[];
	cwd?: string;
	display: string;
	packageManager?: string | null;
}

export interface CommandPlanStep {
	id: string;
	command: string;
	args: string[];
	description: string;
	effect?: "observe" | "verify" | "write";
	process?: CommandProcessSpec;
}

export type CommandPlanEffect = NonNullable<CommandPlanStep["effect"]>;

export interface CommandPlanStepRunResult extends CommandPlanStep {
	ok: boolean;
	exitCode: number;
	stdout: string;
	stderr: string;
	payload?: unknown;
}

export interface CommandPlanCommandRunOptions {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
}

export interface CommandPlanCliStepRunOptions extends CommandPlanCommandRunOptions {
	executable: string;
	entrypoint: string;
	command?: string;
	description?: string;
}

export interface CommandPlanRunResult {
	ok: boolean;
	status: "passed" | "failed";
	steps: CommandPlanStepRunResult[];
	remainingSteps: CommandPlanStep[];
	remainingCommands: string[];
	remainingProcesses: CommandProcessSpec[];
	failedStepId: string | null;
	failedCommand: string | null;
	failedProcess: CommandProcessSpec | null;
	nextActions: string[];
	nextCommands: string[];
	nextProcesses: CommandProcessSpec[];
	recommendations: unknown[];
}

export interface CommandPlanStepSummary {
	id: string;
	command: string;
	description: string;
	ok: boolean;
	exitCode: number;
	effect?: CommandPlanEffect;
	process?: CommandPlanStep["process"];
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
	nextProcesses: CommandProcessSpec[];
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
	remainingSteps: CommandPlanStep[];
	remainingCommands: string[];
	remainingProcesses: CommandProcessSpec[];
	failedStepId: string | null;
	failedCommand: string | null;
	failedProcess: CommandProcessSpec | null;
	command: string;
	operation: string;
	ok: boolean;
	nextAction: string | null;
	nextActions: string[];
	nextCommand: string | null;
	nextCommands: string[];
	nextProcesses: CommandProcessSpec[];
	recommendations: unknown[];
}

export function commandPlanStepCommands(
	steps: readonly CommandPlanStep[],
): string[] {
	return steps.map((step) => step.command);
}

export function commandPlanStepProcesses(
	steps: readonly CommandPlanStep[],
): CommandProcessSpec[] {
	return steps
		.map((step) => step.process)
		.filter((process): process is CommandProcessSpec => Boolean(process));
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
			nextProcesses: commandPlanStepProcesses(steps),
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
		remainingSteps: result.remainingSteps,
		remainingCommands: result.remainingCommands,
		remainingProcesses: result.remainingProcesses,
		failedStepId: result.failedStepId,
		failedCommand: result.failedCommand,
		failedProcess: result.failedProcess,
		command: context.command,
		operation: context.operation,
		ok: result.ok,
		nextAction: result.nextActions[0] ?? result.nextCommands[0] ?? null,
		nextActions: result.nextActions,
		nextCommand: result.nextCommands[0] ?? null,
		nextCommands: result.nextCommands,
		nextProcesses: result.nextProcesses,
		recommendations: result.recommendations,
	};
}

export function commandPlanStepSummary(
	step: CommandPlanStepRunResult,
): CommandPlanStepSummary {
	return {
		id: step.id,
		command: step.command,
		description: step.description,
		ok: step.ok,
		exitCode: step.exitCode,
		...(step.effect ? { effect: step.effect } : {}),
		...(step.process ? { process: step.process } : {}),
		...(step.payload !== undefined ? { payload: commandPlanPayloadSummary(step.payload) } : {}),
	};
}

function commandPlanPayloadSummary(payload: unknown): unknown {
	if (!payload || typeof payload !== "object") {
		return payload;
	}
	if (Array.isArray(payload)) {
		return payload.map(commandPlanPayloadSummary);
	}
	return Object.fromEntries(
		Object.entries(payload as Record<string, unknown>)
			.filter(([key]) => key !== "stdout" && key !== "stderr")
			.map(([key, value]) => [key, commandPlanPayloadSummary(value)]),
	);
}

export function runCommandPlanCliStep(
	args: string[],
	options: CommandPlanCliStepRunOptions,
): CommandPlanStepRunResult {
	const result = spawnSync(options.executable, [options.entrypoint, ...args], {
		cwd: options.cwd ?? process.cwd(),
		env: options.env ?? process.env,
		encoding: "utf-8",
	});
	const exitCode = result.status ?? (result.error ? 1 : 0);
	const stdout = result.stdout ?? "";
	const stderr = result.stderr ?? "";
	const payload = parseCommandJsonPayload(stdout);
	return {
		id: args.join(" "),
		command: options.command ?? shellCommand(options.executable, [options.entrypoint, ...args]),
		args,
		description: options.description ?? "CLI command execution result.",
		ok: exitCode === 0,
		exitCode,
		stdout,
		stderr,
		...(payload !== undefined ? { payload } : {}),
	};
}

export function runCommandPlanProcessStep(
	step: CommandPlanStep,
	options: CommandPlanCommandRunOptions = {},
): CommandPlanStepRunResult {
	if (!step.process) {
		throw new Error(`Command plan step ${step.id} has no process metadata.`);
	}
	const result = spawnSync(step.process.command, step.process.args, {
		cwd: step.process.cwd ?? options.cwd ?? process.cwd(),
		env: options.env ?? process.env,
		encoding: "utf-8",
	});
	const exitCode = result.status ?? (result.error ? 1 : 0);
	return {
		...step,
		ok: exitCode === 0,
		exitCode,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

export function runCommandPlan(
	stepsToRun: readonly CommandPlanStep[],
	runStep: (step: CommandPlanStep) => CommandPlanStepRunResult,
): CommandPlanRunResult {
	const steps: CommandPlanStepRunResult[] = [];
	for (const [index, step] of stepsToRun.entries()) {
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
			const remainingSteps = stepsToRun.slice(index + 1);
			const payloadNextCommands = commandPayloadNextCommands(result.payload);
			const nextActions = normalizeHandoffValues(
				commandPayloadNextActions(result.payload) ??
					payloadNextCommands ?? [step.command],
			);
			const nextCommands = normalizeHandoffValues(
				payloadNextCommands ?? [step.command],
			);
			return {
				ok: false,
				status: "failed",
				steps,
				remainingSteps,
				remainingCommands: commandPlanStepCommands(remainingSteps),
				remainingProcesses: commandPlanStepProcesses(remainingSteps),
				failedStepId: step.id,
				failedCommand: step.command,
				failedProcess: step.process ?? null,
				nextActions,
				nextCommands,
				nextProcesses: payloadNextCommands ? [] : commandPlanStepProcesses([step]),
				recommendations: commandPayloadRecommendations(result.payload) ?? [],
			};
		}
	}
	return {
		ok: true,
		status: "passed",
		steps,
		remainingSteps: [],
		remainingCommands: [],
		remainingProcesses: [],
		failedStepId: null,
		failedCommand: null,
		failedProcess: null,
		nextActions: [],
		nextCommands: [],
		nextProcesses: [],
		recommendations: [],
	};
}
