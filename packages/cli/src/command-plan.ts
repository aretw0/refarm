import {
	buildJsonSuccessEnvelope,
	type JsonSuccessEnvelope,
} from "@refarm.dev/capabilities/envelope";
import { spawnSync } from "node:child_process";
import { normalizeHandoffValues, shellCommand } from "./command-handoff.js";
import {
	commandPayloadNextActions,
	commandPayloadNextCommands,
	commandPayloadOk,
	commandPayloadRecommendations,
	parseCommandJsonPayload,
} from "./command-result.js";

export interface CommandProcessSpec {
	command: string;
	args: string[];
	cwd?: string;
	display: string;
	packageManager?: string | null;
	resourcePolicy?: CommandProcessResourcePolicy;
	timeoutMs?: number;
	tool?: string;
}

export interface CommandProcessResourcePolicy {
	concurrency?: number;
	fallbackCommand?: string;
	timeoutMs?: number;
	workClass?: CommandPlanWorkClass;
}

export type CommandPlanWorkClass =
	| "focused-check"
	| "package-check"
	| "broad-check"
	| "worker-fanout"
	| "mutation";

export type CommandPlanResourceCeilingDecision = "allow" | "degrade" | "serialize" | "refuse";

export interface CommandPlanResourceCeilingPlan {
	schemaVersion?: 1;
	ok: boolean;
	decision: CommandPlanResourceCeilingDecision;
	workClass: CommandPlanWorkClass;
	pressureDecision?: string;
	reason: string;
	nextAction?: string | null;
	nextActions?: string[];
	nextCommand?: string | null;
	nextCommands?: string[];
	maxConcurrency?: number | null;
	recommendations?: unknown[];
}

export interface CommandPlanRunOptions {
	planResourceCeiling?: (
		step: CommandPlanStep,
	) => CommandPlanResourceCeilingPlan | null | undefined;
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

export interface CommandPlanCacheObservation {
	tool: string;
	cached: number;
	total: number;
	hitRate: number;
	status: string;
	tasksSuccessful?: number;
	tasksTotal?: number;
}

export interface CommandPlanStepCacheObservation extends CommandPlanCacheObservation {
	stepId: string;
	command: string;
}

export interface CommandPlanStepRunResult extends CommandPlanStep {
	ok: boolean;
	exitCode: number;
	elapsedMs?: number;
	/**
	 * The step was KILLED at its ceiling — it did not fail.
	 *
	 * A distinct fact because the two demand opposite responses: a failure is read, diagnosed and
	 * fixed; a kill means the work never finished and the budget, not the code, is what to look at.
	 * Collapsing them cost two wrong diagnoses on a real lane run (ISS-149), where the killed
	 * step's entire output was a startup banner and read as "something in this package broke".
	 */
	timedOut?: boolean;
	/** The ceiling that killed it, so a reader can judge it without finding the constant. */
	timeoutMs?: number;
	stdout: string;
	stderr: string;
	payload?: unknown;
	cache?: CommandPlanCacheObservation;
}

export interface CommandPlanCommandRunOptions {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
}

export interface CommandPlanCliStepRunOptions extends CommandPlanCommandRunOptions {
	executable: string;
	entrypoint: string;
	command?: string;
	description?: string;
}

export interface CommandPlanRunResult {
	ok: boolean;
	/**
	 * `timed-out` is a THIRD outcome, not a flavour of `failed`. A caller that retries on failure
	 * would retry a killed step forever at the same ceiling; one that reports failure to a human
	 * would send them to debug code that is fine.
	 */
	status: "passed" | "failed" | "timed-out";
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
	elapsedMs?: number;
	/** The step was killed at its ceiling rather than failing — see CommandPlanStepRunResult. */
	timedOut?: boolean;
	timeoutMs?: number;
	effect?: CommandPlanEffect;
	process?: CommandPlanStep["process"];
	payload?: unknown;
	cache?: CommandPlanCacheObservation;
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

export type CommandPlanEnvelope = JsonSuccessEnvelope<CommandPlanEnvelopeExtra>;

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

export function commandPlanStepCommands(steps: readonly CommandPlanStep[]): string[] {
	return steps.map((step) => step.command);
}

export function commandPlanStepProcesses(steps: readonly CommandPlanStep[]): CommandProcessSpec[] {
	return steps
		.map((step) => step.process)
		.filter((process): process is CommandProcessSpec => Boolean(process));
}

export function commandPlanEffects(steps: readonly CommandPlanStep[]): CommandPlanEffect[] {
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

export function commandPlanStepSummary(step: CommandPlanStepRunResult): CommandPlanStepSummary {
	return {
		id: step.id,
		command: step.command,
		description: step.description,
		ok: step.ok,
		exitCode: step.exitCode,
		...(step.elapsedMs !== undefined ? { elapsedMs: step.elapsedMs } : {}),
		// Carried into the printed envelope: a reader deciding what to do next must not have to
		// parse English out of stderr to learn that nothing actually failed.
		...(step.timedOut !== undefined ? { timedOut: step.timedOut } : {}),
		...(step.timeoutMs !== undefined ? { timeoutMs: step.timeoutMs } : {}),
		...(step.effect ? { effect: step.effect } : {}),
		...(step.process ? { process: step.process } : {}),
		...(step.payload !== undefined ? { payload: commandPlanPayloadSummary(step.payload) } : {}),
		...(step.cache ? { cache: step.cache } : {}),
	};
}

export function commandPlanCacheObservations(
	result: CommandPlanRunResult,
): CommandPlanStepCacheObservation[] {
	return result.steps.flatMap((step) =>
		step.cache ? [{ ...step.cache, stepId: step.id, command: step.command }] : [],
	);
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
	const startedAt = Date.now();
	const result = spawnSync(options.executable, [options.entrypoint, ...args], {
		// os-resolution: process — the working directory handed to a spawned child process
		cwd: options.cwd ?? process.cwd(),
		env: options.env ?? process.env,
		encoding: "utf-8",
		timeout: options.timeoutMs,
	});
	const exitCode = result.status ?? (result.error ? 1 : 0);
	const stdout = result.stdout ?? "";
	const stderr = commandPlanSpawnErrorMessage(
		result.stderr,
		exitCode === 0 ? undefined : result.error,
		result.signal,
		options.timeoutMs,
	);
	const payload = parseCommandJsonPayload(stdout);
	return {
		id: args.join(" "),
		command: options.command ?? shellCommand(options.executable, [options.entrypoint, ...args]),
		args,
		description: options.description ?? "CLI command execution result.",
		ok: exitCode === 0,
		exitCode,
		elapsedMs: Date.now() - startedAt,
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
	const startedAt = Date.now();
	const result = spawnSync(step.process.command, step.process.args, {
		// os-resolution: process — the working directory handed to a spawned child process
		cwd: step.process.cwd ?? options.cwd ?? process.cwd(),
		env: options.env ?? process.env,
		encoding: "utf-8",
		timeout: step.process.timeoutMs ?? options.timeoutMs,
	});
	const exitCode = result.status ?? (result.error ? 1 : 0);
	const timeoutMs = step.process.timeoutMs ?? options.timeoutMs;
	const timedOut = commandPlanTimedOut(result.signal, result.error, timeoutMs);
	return {
		...step,
		ok: exitCode === 0,
		exitCode,
		elapsedMs: Date.now() - startedAt,
		timedOut,
		...(timedOut && timeoutMs !== undefined ? { timeoutMs } : {}),
		stdout: result.stdout ?? "",
		stderr: commandPlanSpawnErrorMessage(
			result.stderr,
			exitCode === 0 ? undefined : result.error,
			result.signal,
			timeoutMs,
			timedOut,
		),
	};
}

/**
 * PURE. Was this process killed by ITS OWN ceiling?
 *
 * `spawnSync` reports a timeout kill as a signal, and Node also raises an `ETIMEDOUT` error on the
 * versions that carry one. Either is enough; requiring both would miss the kill on the versions
 * that report only a signal, and requiring neither would call every externally-terminated process
 * a timeout. A signal with NO declared ceiling is somebody else's kill, and is not claimed here.
 */
function commandPlanTimedOut(
	signal: NodeJS.Signals | null,
	error: (Error & { code?: string }) | undefined,
	timeoutMs: number | undefined,
): boolean {
	if (error?.code === "ETIMEDOUT") return true;
	return signal !== null && timeoutMs !== undefined;
}

function commandPlanSpawnErrorMessage(
	stderr: string | null | undefined,
	error: Error | undefined,
	signal: NodeJS.Signals | null,
	timeoutMs: number | undefined,
	timedOut = false,
): string {
	// FIRST, not instead. The old order returned `stderr` whenever it was non-empty, so a process
	// that printed anything at all before being killed — a startup banner is enough — reported the
	// banner and nothing else. The kill is the fact that explains the result; the output is the
	// evidence, and both are kept.
	if (timedOut) {
		const ceiling = timeoutMs !== undefined ? `after ${timeoutMs}ms` : "at its ceiling";
		const cause = signal ? ` (${signal})` : "";
		const head =
			`Command timed out ${ceiling}${cause}. NOTHING FAILED — the step was killed before it ` +
			"finished, so its output below is partial.";
		return stderr ? `${head}\n${stderr}` : head;
	}
	if (stderr) return stderr;
	if (error?.message) return error.message;
	return "";
}

export function runCommandPlan(
	stepsToRun: readonly CommandPlanStep[],
	runStep: (step: CommandPlanStep) => CommandPlanStepRunResult,
	options: CommandPlanRunOptions = {},
): CommandPlanRunResult {
	const steps: CommandPlanStepRunResult[] = [];
	for (const [index, step] of stepsToRun.entries()) {
		const resourceCeiling = options.planResourceCeiling?.(step);
		const serializedStep = resourceCeiling
			? commandPlanSerializedStep(step, resourceCeiling)
			: null;
		const executableStep = serializedStep ?? step;
		if (resourceCeiling && !serializedStep && shouldStopForResourceCeiling(resourceCeiling)) {
			const normalized = commandPlanResourceCeilingStepResult(step, resourceCeiling);
			steps.push(normalized);
			const remainingSteps = stepsToRun.slice(index + 1);
			const nextActions = commandPlanResourceCeilingNextActions(resourceCeiling);
			const nextCommands = commandPlanResourceCeilingNextCommands(resourceCeiling);
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
				nextProcesses: [],
				recommendations: resourceCeiling.recommendations ?? [],
			};
		}
		const startedAt = Date.now();
		const observed = runStep(executableStep);
		const elapsedMs = Math.max(0, Date.now() - startedAt);
		const result = {
			...observed,
			id: executableStep.id,
			command: executableStep.command,
			args: executableStep.args,
			description: executableStep.description,
			effect: executableStep.effect,
			elapsedMs,
		};
		const payloadOk = commandPayloadOk(result.payload);
		const ok = result.exitCode === 0 && payloadOk !== false;
		const normalized = { ...result, ok };
		steps.push(normalized);
		if (!ok) {
			const remainingSteps = stepsToRun.slice(index + 1);
			const payloadNextCommands = commandPayloadNextCommands(result.payload);
			const fallbackNextActions = commandPlanStepFallbackNextActions(executableStep, result);
			const nextActions = normalizeHandoffValues(
				commandPayloadNextActions(result.payload) ?? payloadNextCommands ?? fallbackNextActions,
			);
			const nextCommands = normalizeHandoffValues(payloadNextCommands ?? [executableStep.command]);
			return {
				ok: false,
				// The distinction reaches the RUN, not only the step: a caller that retries on
				// failure would retry a killed step forever at the same ceiling.
				status: normalized.timedOut ? "timed-out" : "failed",
				steps,
				remainingSteps,
				remainingCommands: commandPlanStepCommands(remainingSteps),
				remainingProcesses: commandPlanStepProcesses(remainingSteps),
				failedStepId: executableStep.id,
				failedCommand: executableStep.command,
				failedProcess: executableStep.process ?? null,
				nextActions,
				nextCommands,
				nextProcesses: payloadNextCommands ? [] : commandPlanStepProcesses([executableStep]),
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

function commandPlanStepFallbackNextActions(
	step: CommandPlanStep,
	result: CommandPlanStepRunResult,
): string[] {
	if (isNestedSpawnRestricted(result)) {
		return [
			`Run \`${step.command}\` directly; this environment restricts nested process spawning.`,
		];
	}
	return [step.command];
}

function isNestedSpawnRestricted(result: CommandPlanStepRunResult): boolean {
	return /spawnSync .* EPERM/.test(result.stderr);
}

function shouldStopForResourceCeiling(resourceCeiling: CommandPlanResourceCeilingPlan): boolean {
	return resourceCeiling.ok === false || resourceCeiling.decision !== "allow";
}

function commandPlanSerializedStep(
	step: CommandPlanStep,
	resourceCeiling: CommandPlanResourceCeilingPlan,
): CommandPlanStep | null {
	if (resourceCeiling.decision !== "serialize") return null;
	const maxConcurrency = resourceCeiling.maxConcurrency;
	if (!Number.isInteger(maxConcurrency) || Number(maxConcurrency) < 1) {
		return null;
	}
	const process = step.process;
	const currentConcurrency = process?.resourcePolicy?.concurrency;
	if (!process || !Number.isInteger(currentConcurrency)) return null;
	if (Number(currentConcurrency) <= Number(maxConcurrency)) return step;
	const serializedProcessArgs = commandPlanSerializedConcurrencyArgs(
		process.args,
		Number(maxConcurrency),
	);
	if (!serializedProcessArgs) return null;
	const serializedDisplay =
		commandPlanSerializedConcurrencyText(process.display, Number(maxConcurrency)) ??
		shellCommand(process.command, serializedProcessArgs);
	const serializedCommand =
		commandPlanSerializedConcurrencyText(step.command, Number(maxConcurrency)) ?? serializedDisplay;
	return {
		...step,
		command: serializedCommand,
		args: [process.command, ...serializedProcessArgs],
		process: {
			...process,
			args: serializedProcessArgs,
			display: serializedDisplay,
			resourcePolicy: {
				...process.resourcePolicy,
				concurrency: Number(maxConcurrency),
			},
		},
	};
}

function commandPlanSerializedConcurrencyArgs(
	args: readonly string[],
	maxConcurrency: number,
): string[] | null {
	for (const [index, arg] of args.entries()) {
		if (/^--concurrency=\d+$/.test(arg)) {
			const nextArgs = [...args];
			nextArgs[index] = `--concurrency=${maxConcurrency}`;
			return nextArgs;
		}
		if (arg === "--concurrency" && /^\d+$/.test(args[index + 1] ?? "")) {
			const nextArgs = [...args];
			nextArgs[index + 1] = String(maxConcurrency);
			return nextArgs;
		}
	}
	return null;
}

function commandPlanSerializedConcurrencyText(
	value: string,
	maxConcurrency: number,
): string | null {
	if (/--concurrency=\d+/.test(value)) {
		return value.replace(/--concurrency=\d+/, `--concurrency=${maxConcurrency}`);
	}
	if (/--concurrency\s+\d+/.test(value)) {
		return value.replace(/--concurrency\s+\d+/, `--concurrency ${maxConcurrency}`);
	}
	return null;
}

function commandPlanResourceCeilingStepResult(
	step: CommandPlanStep,
	resourceCeiling: CommandPlanResourceCeilingPlan,
): CommandPlanStepRunResult {
	return {
		...step,
		ok: false,
		exitCode: 1,
		stdout: "",
		stderr: resourceCeiling.reason,
		payload: {
			ok: false,
			resourceCeiling,
			nextActions: commandPlanResourceCeilingNextActions(resourceCeiling),
			nextCommands: commandPlanResourceCeilingNextCommands(resourceCeiling),
			recommendations: resourceCeiling.recommendations ?? [],
		},
	};
}

function commandPlanResourceCeilingNextActions(
	resourceCeiling: CommandPlanResourceCeilingPlan,
): string[] {
	const nextActions = normalizeHandoffValues([
		...(resourceCeiling.nextActions ?? []),
		resourceCeiling.nextAction ?? "",
	]);
	return nextActions.length > 0 ? nextActions : [resourceCeiling.reason];
}

function commandPlanResourceCeilingNextCommands(
	resourceCeiling: CommandPlanResourceCeilingPlan,
): string[] {
	return normalizeHandoffValues([
		...(resourceCeiling.nextCommands ?? []),
		resourceCeiling.nextCommand ?? "",
	]);
}
