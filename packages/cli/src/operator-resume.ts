import {
	applicationCommand,
	applicationProcess,
	type ApplicationProcessSpec,
} from "./command-handoff.js";
import {
	buildJsonSuccessEnvelope,
	type JsonSuccessEnvelope,
} from "./json-output.js";
import type { RefarmStatusJson } from "./status.js";

export interface OperatorResumeModelRoute {
	scope?: string;
	provider?: string;
	modelId?: string;
	ref?: string;
}

export interface OperatorResumeTaskRecord {
	effortId: string;
	transport: string;
	lastStatus?: string;
	lastStatusAt?: string;
	lastCommand?: string;
	lastLogAt?: string;
	lastModelRoute?: OperatorResumeModelRoute;
	statusCommand: string;
	logsCommand: string;
}

export interface OperatorResumeTaskCheckpoint {
	updatedAt: string;
	activeEffortId?: string;
	efforts: readonly OperatorResumeTaskRecord[];
}

export interface OperatorResumeCommands {
	runtimeDoctor: string;
	taskList: string;
	taskResume: string;
	modelCurrent: string;
	sessionClear: string;
	sessionList: string;
	sessionShow: (sessionId: string) => string;
}

export interface OperatorResumeSessionRecord {
	sessionId: string;
	shortId?: string;
	name?: string | null;
	createdAtNs?: number | null;
	hasHistory?: boolean;
	canonicalParticipants?: readonly string[];
	participantAliases?: readonly OperatorResumeSessionParticipantAlias[];
	showCommand?: string;
	useCommand?: string;
}

export interface OperatorResumeSessionParticipantAlias {
	participantId: string;
	canonicalParticipantId: string;
}

export interface OperatorResumeFinishRecord {
	updatedAt: string;
	status: "passed" | "failed";
	command: string;
	profile?: string | null;
	lane?: string | null;
	validationScope?: string | null;
	failedStepId?: string | null;
	failedCommand?: string | null;
	nextCommands: readonly string[];
	remainingCommands: readonly string[];
}

export interface OperatorResumeInput {
	status?: RefarmStatusJson;
	model?: OperatorResumeModelSummary;
	taskCheckpoint?: OperatorResumeTaskCheckpoint | null;
	activeSessionId?: string | null;
	recentSessions?: readonly OperatorResumeSessionRecord[];
	recentPrompts?: readonly string[];
	finish?: OperatorResumeFinishRecord | null;
	commands?: Partial<OperatorResumeCommands>;
}

export interface OperatorResumeTaskSummary {
	checkpointUpdatedAt?: string;
	activeEffort?: OperatorResumeTaskRecord;
	recentEfforts: readonly OperatorResumeTaskRecord[];
	totalEfforts: number;
}

export interface OperatorResumeRuntimeSummary {
	ready: boolean;
	namespace: string;
	engine?: RefarmStatusJson["runtime"]["engine"];
	diagnostics: readonly string[];
}

export interface OperatorResumeModelSummary {
	current: OperatorResumeModelRoute;
	routes?: Partial<Record<string, string>>;
	credential?: {
		state?: string;
		status?: string | null;
		envKey?: string;
	};
	source?: string;
	inspectCommand?: string;
	doctorCommand?: string;
}

export interface OperatorResumeSessionSummary {
	status: "none" | "active" | "stale";
	activeSessionId?: string;
	shortId?: string;
	showCommand?: string;
	canonicalParticipants?: readonly string[];
	participantAliases?: readonly OperatorResumeSessionParticipantAlias[];
	recentSessions: readonly OperatorResumeSessionRecord[];
}

export interface OperatorResumeFinishSummary {
	status: "none" | "passed" | "failed";
	updatedAt?: string;
	command?: string;
	profile?: string | null;
	lane?: string | null;
	validationScope?: string | null;
	failedStepId?: string | null;
	failedCommand?: string | null;
	nextCommands: readonly string[];
	remainingCommands: readonly string[];
}

export interface OperatorResumeSummary {
	status: "empty" | "ok";
	runtime?: OperatorResumeRuntimeSummary;
	model?: OperatorResumeModelSummary;
	session: OperatorResumeSessionSummary;
	recentPrompts: readonly string[];
	finish: OperatorResumeFinishSummary;
	tasks: OperatorResumeTaskSummary;
}

export type OperatorResumeEnvelope =
	JsonSuccessEnvelope<
		OperatorResumeSummary & { nextProcesses: readonly ApplicationProcessSpec[] }
	>;

function refarmAppCommand(args: string[]): string {
	return applicationCommand("refarm", args);
}

function refarmAppProcess(args: string[]): ApplicationProcessSpec {
	return applicationProcess("refarm", args);
}

const DEFAULT_OPERATOR_RESUME_COMMANDS: OperatorResumeCommands = {
	runtimeDoctor: refarmAppCommand(["doctor", "--next-command"]),
	taskList: refarmAppCommand(["task", "list", "--json"]),
	taskResume: refarmAppCommand(["task", "resume", "--json"]),
	modelCurrent: refarmAppCommand(["model", "current", "--json"]),
	sessionClear: refarmAppCommand(["sessions", "clear", "--json"]),
	sessionList: refarmAppCommand(["sessions", "list", "--json"]),
	sessionShow: (sessionId) =>
		refarmAppCommand([
			"sessions",
			"show",
			formatOperatorResumeSessionId(sessionId),
			"--json",
		]),
};

const DEFAULT_OPERATOR_RESUME_PROCESSES = {
	runtimeDoctor: refarmAppProcess(["doctor", "--next-command"]),
	taskList: refarmAppProcess(["task", "list", "--json"]),
	taskResume: refarmAppProcess(["task", "resume", "--json"]),
	modelCurrent: refarmAppProcess(["model", "current", "--json"]),
	sessionClear: refarmAppProcess(["sessions", "clear", "--json"]),
	sessionList: refarmAppProcess(["sessions", "list", "--json"]),
	sessionShow: (sessionId: string) =>
		refarmAppProcess([
			"sessions",
			"show",
			formatOperatorResumeSessionId(sessionId),
			"--json",
		]),
};

function hasCommandFlag(command: string, flag: string): boolean {
	return new RegExp(`(?:^|\\s)${flag}(?:\\s|$)`).test(command);
}

function ensureCommandFlag(command: string, flag: string): string {
	return hasCommandFlag(command, flag) ? command : `${command} ${flag}`;
}

function taskReadJsonCommand(command: string): string {
	return ensureCommandFlag(command, "--json");
}

function taskWatchJsonCommand(command: string): string {
	return taskReadJsonCommand(ensureCommandFlag(command, "--watch"));
}

function taskJsonRecord(
	effort: OperatorResumeTaskRecord,
): OperatorResumeTaskRecord {
	return {
		...effort,
		statusCommand: taskReadJsonCommand(effort.statusCommand),
		logsCommand: taskReadJsonCommand(effort.logsCommand),
	};
}

function taskJsonSummary(
	tasks: OperatorResumeTaskSummary,
): OperatorResumeTaskSummary {
	const recentEfforts = tasks.recentEfforts.map(taskJsonRecord);
	return {
		...tasks,
		activeEffort: tasks.activeEffort
			? taskJsonRecord(tasks.activeEffort)
			: undefined,
		recentEfforts,
	};
}

function isTerminalTaskStatus(status: string | undefined): boolean {
	return status === "done" ||
		status === "partial" ||
		status === "failed" ||
		status === "timed-out" ||
		status === "cancelled" ||
		status === "not-found";
}

function hasResumableTaskEffort(tasks: OperatorResumeTaskSummary): boolean {
	return tasks.recentEfforts.some((effort) => !isTerminalTaskStatus(effort.lastStatus));
}

function operatorResumeJsonSummary(
	summary: OperatorResumeSummary,
): OperatorResumeSummary {
	return {
		...summary,
		tasks: taskJsonSummary(summary.tasks),
	};
}

function operatorResumeParticipantDisplay(
	record:
		| OperatorResumeSessionSummary
		| Pick<
				OperatorResumeSessionRecord,
				"canonicalParticipants" | "participantAliases"
		  >,
): string | undefined {
	const participants =
		record.canonicalParticipants && record.canonicalParticipants.length > 0
			? record.canonicalParticipants
			: record.participantAliases?.map((alias) => alias.canonicalParticipantId);
	const uniqueParticipants = [...new Set(participants ?? [])];
	return uniqueParticipants.length > 0 ? uniqueParticipants.join(", ") : undefined;
}

export function formatOperatorResumeSessionId(id: string): string {
	const parts = id.split(":");
	return parts.at(-1)?.slice(-12) ?? id;
}

export function formatOperatorResumeModelRoute(
	route: OperatorResumeModelRoute | undefined,
): string | undefined {
	if (!route) return undefined;
	const ref =
		route.ref ??
		(route.provider && route.modelId
			? `${route.provider}/${route.modelId}`
			: route.provider ?? route.modelId);
	if (route.scope && ref) return `${route.scope} ${ref}`;
	return route.scope ?? ref;
}

export function buildOperatorResumeSummary(
	input: OperatorResumeInput,
): OperatorResumeSummary {
	const efforts = input.taskCheckpoint?.efforts ?? [];
	const activeEffort = input.taskCheckpoint?.activeEffortId
		? efforts.find(
				(effort) => effort.effortId === input.taskCheckpoint?.activeEffortId,
			)
		: undefined;
	const runtime = input.status
		? {
				ready: input.status.runtime.ready,
				namespace: input.status.runtime.namespace,
				engine: input.status.runtime.engine,
				diagnostics: input.status.diagnostics,
			}
		: undefined;
	const tasks: OperatorResumeTaskSummary = {
		checkpointUpdatedAt: input.taskCheckpoint?.updatedAt,
		activeEffort,
		recentEfforts: efforts.slice(0, 10),
		totalEfforts: efforts.length,
	};
	const recentSessions = (input.recentSessions ?? []).slice(0, 5);
	const activeShortId = input.activeSessionId
		? formatOperatorResumeSessionId(input.activeSessionId)
		: undefined;
	const activeRecentSession = input.activeSessionId
		? recentSessions.find(
				(session) =>
					session.sessionId === input.activeSessionId ||
					session.shortId === activeShortId,
			)
		: undefined;
	const sessionStatus = input.activeSessionId
		? activeRecentSession ? "active" : "stale"
		: "none";
	const sessionShowCommand = activeRecentSession?.showCommand;
	const session: OperatorResumeSessionSummary = {
		status: sessionStatus,
		activeSessionId: input.activeSessionId ?? undefined,
		shortId: activeShortId,
		showCommand: sessionShowCommand,
		canonicalParticipants: activeRecentSession?.canonicalParticipants,
		participantAliases: activeRecentSession?.participantAliases,
		recentSessions,
	};
	const finish: OperatorResumeFinishSummary = input.finish
		? {
				status: input.finish.status,
				updatedAt: input.finish.updatedAt,
				command: input.finish.command,
				profile: input.finish.profile ?? null,
				lane: input.finish.lane ?? null,
				validationScope: input.finish.validationScope ?? null,
				failedStepId: input.finish.failedStepId ?? null,
				failedCommand: input.finish.failedCommand ?? null,
				nextCommands: input.finish.nextCommands,
				remainingCommands: input.finish.remainingCommands,
			}
		: {
				status: "none",
				nextCommands: [],
				remainingCommands: [],
			};
	return {
			status: runtime ||
				Boolean(input.model) ||
				session.status !== "none" ||
			session.recentSessions.length > 0 ||
			efforts.length > 0 ||
			(input.recentPrompts?.length ?? 0) > 0 ||
			finish.status !== "none"
			? "ok"
			: "empty",
		runtime,
		model: input.model,
		session,
		recentPrompts: (input.recentPrompts ?? []).slice(0, 5),
		finish,
		tasks,
	};
}

export function operatorResumeNextCommands(
	summary: OperatorResumeSummary,
	commands: Partial<OperatorResumeCommands> = {},
): string[] {
	const resolved = { ...DEFAULT_OPERATOR_RESUME_COMMANDS, ...commands };

	// Emergency: runtime not ready — fix that first, everything else is noise.
	if (summary.runtime && !summary.runtime.ready) {
		const recovery = summary.finish.status === "failed"
			? summary.finish.nextCommands
			: [];
		return [...new Set([resolved.runtimeDoctor, ...recovery])];
	}

	const nextCommands: string[] = [];

	// Recovery: finish failed — the most urgent resumption point.
	if (summary.finish.status === "failed") {
		nextCommands.push(...summary.finish.nextCommands);
	}

	// Context: show the active or most recent session.
	const sessionCommand = summary.session.showCommand
		?? summary.session.recentSessions[0]?.showCommand;
	if (sessionCommand) nextCommands.push(sessionCommand);
	else if (summary.session.status === "stale") {
		nextCommands.push(resolved.sessionClear);
		nextCommands.push(resolved.sessionList);
	}

	// Model: only surface when credentials are missing, not on every resume.
	if (summary.model?.credential?.state === "missing") {
		nextCommands.push(
			summary.model.inspectCommand ?? resolved.modelCurrent,
		);
	}

	// Task: active effort takes priority; checkpoints resume before generic list.
	if (summary.tasks.activeEffort) {
		nextCommands.push(
			taskWatchJsonCommand(summary.tasks.activeEffort.statusCommand),
			taskReadJsonCommand(summary.tasks.activeEffort.logsCommand),
		);
	} else if (hasResumableTaskEffort(summary.tasks)) {
		nextCommands.push(resolved.taskResume);
	} else if (summary.tasks.totalEfforts === 0) {
		nextCommands.push(resolved.taskList);
	}

	return [...new Set(nextCommands)];
}

function commandProcessKey(processSpec: ApplicationProcessSpec): string {
	return `${processSpec.command}\0${processSpec.args.join("\0")}`;
}

function dedupeCommandProcesses(
	processes: ApplicationProcessSpec[],
): ApplicationProcessSpec[] {
	const seen = new Set<string>();
	return processes.filter((processSpec) => {
		const key = commandProcessKey(processSpec);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

export function operatorResumeNextProcesses(
	summary: OperatorResumeSummary,
	commands: Partial<OperatorResumeCommands> = {},
): ApplicationProcessSpec[] {
	const nextCommands = operatorResumeNextCommands(summary, commands);
	const processByCommand = new Map<string, ApplicationProcessSpec>();
	const addDefaultProcess = (
		command: string,
		processSpec: ApplicationProcessSpec,
	): void => {
		processByCommand.set(command, processSpec);
	};

	addDefaultProcess(
		DEFAULT_OPERATOR_RESUME_COMMANDS.runtimeDoctor,
		DEFAULT_OPERATOR_RESUME_PROCESSES.runtimeDoctor,
	);
	addDefaultProcess(
		DEFAULT_OPERATOR_RESUME_COMMANDS.taskList,
		DEFAULT_OPERATOR_RESUME_PROCESSES.taskList,
	);
	addDefaultProcess(
		DEFAULT_OPERATOR_RESUME_COMMANDS.taskResume,
		DEFAULT_OPERATOR_RESUME_PROCESSES.taskResume,
	);
	addDefaultProcess(
		DEFAULT_OPERATOR_RESUME_COMMANDS.modelCurrent,
		DEFAULT_OPERATOR_RESUME_PROCESSES.modelCurrent,
	);
	addDefaultProcess(
		DEFAULT_OPERATOR_RESUME_COMMANDS.sessionClear,
		DEFAULT_OPERATOR_RESUME_PROCESSES.sessionClear,
	);
	addDefaultProcess(
		DEFAULT_OPERATOR_RESUME_COMMANDS.sessionList,
		DEFAULT_OPERATOR_RESUME_PROCESSES.sessionList,
	);
	for (const session of summary.session.recentSessions) {
		if (session.showCommand) {
			addDefaultProcess(
				session.showCommand,
				DEFAULT_OPERATOR_RESUME_PROCESSES.sessionShow(session.sessionId),
			);
		}
	}
	if (summary.session.activeSessionId && summary.session.showCommand) {
		addDefaultProcess(
			summary.session.showCommand,
			DEFAULT_OPERATOR_RESUME_PROCESSES.sessionShow(
				summary.session.activeSessionId,
			),
		);
	}
	if (summary.tasks.activeEffort) {
		const effort = summary.tasks.activeEffort;
		addDefaultProcess(taskWatchJsonCommand(effort.statusCommand), {
			...refarmAppProcess([
				"task",
				"status",
				effort.effortId,
				"--transport",
				effort.transport,
				"--watch",
				"--json",
			]),
		});
		addDefaultProcess(taskReadJsonCommand(effort.logsCommand), {
			...refarmAppProcess([
				"task",
				"logs",
				effort.effortId,
				"--transport",
				effort.transport,
				"--json",
			]),
		});
	}

	return dedupeCommandProcesses(
		nextCommands
			.map((command) => processByCommand.get(command))
			.filter(
				(processSpec): processSpec is ApplicationProcessSpec =>
					processSpec !== undefined,
			),
	);
}

export function buildOperatorResumeEnvelope(
	input: OperatorResumeInput,
): OperatorResumeEnvelope {
	const summary = buildOperatorResumeSummary(input);
	const nextCommands = operatorResumeNextCommands(summary, input.commands);
	const nextProcesses = operatorResumeNextProcesses(summary, input.commands);
	return buildJsonSuccessEnvelope<
		OperatorResumeSummary & { nextProcesses: readonly ApplicationProcessSpec[] }
	>({
		command: "resume",
		operation: "operator",
		nextActions: nextCommands,
		nextCommands,
		extra: {
			...operatorResumeJsonSummary(summary),
			nextProcesses,
		},
	});
}

export function formatOperatorResumeSummary(
	summary: OperatorResumeSummary,
): string {
	const lines: string[] = [];
	lines.push("Operator resume");
	if (summary.runtime) {
		const engine = summary.runtime.engine
			? ` engine=${summary.runtime.engine.activeEngine}`
			: "";
		lines.push(
			`Runtime: ${summary.runtime.ready ? "ready" : "not-ready"} namespace=${summary.runtime.namespace}${engine}`,
		);
		if (summary.runtime.diagnostics.length > 0) {
			lines.push(`Diagnostics: ${summary.runtime.diagnostics.join(", ")}`);
		}
	} else {
		lines.push("Runtime: not inspected");
	}
	if (summary.model) {
		const current = formatOperatorResumeModelRoute(summary.model.current);
		lines.push(`Model: ${current ?? "<not configured>"}`);
		if (summary.model.credential?.status) {
			lines.push(`  credential: ${summary.model.credential.status}`);
		} else if (summary.model.credential?.state) {
			lines.push(`  credential: ${summary.model.credential.state}`);
		}
		if (summary.model.source) {
			lines.push(`  source: ${summary.model.source}`);
		}
		if (summary.model.inspectCommand) {
			lines.push(`  inspect: ${summary.model.inspectCommand}`);
		}
		if (summary.model.doctorCommand) {
			lines.push(`  doctor:  ${summary.model.doctorCommand}`);
		}
	} else {
		lines.push("Model: not inspected");
	}
	if (
		(summary.session.status === "active" || summary.session.status === "stale") &&
		summary.session.activeSessionId
	) {
		lines.push(
			`Session: ${summary.session.status}=${summary.session.shortId ?? summary.session.activeSessionId}`,
		);
		if (summary.session.showCommand) {
			lines.push(`  show: ${summary.session.showCommand}`);
		} else if (summary.session.status === "stale") {
			lines.push("  show: unavailable; clear or inspect sessions list");
		}
		const participants = operatorResumeParticipantDisplay(summary.session);
		if (participants) lines.push(`  participants: ${participants}`);
	} else {
		lines.push("Session: none");
	}
	if (summary.session.recentSessions.length > 0) {
		lines.push("Recent sessions:");
		for (const session of summary.session.recentSessions) {
			const name = session.name ? ` name=${session.name}` : "";
			const history = session.hasHistory ? " history=yes" : " history=no";
			const active =
				session.sessionId === summary.session.activeSessionId ? " *" : "";
			lines.push(
				`  ${active}${session.shortId ?? formatOperatorResumeSessionId(session.sessionId)}${name}${history}`,
			);
			const participants = operatorResumeParticipantDisplay(session);
			if (participants) lines.push(`    participants: ${participants}`);
			if (session.showCommand) lines.push(`    show: ${session.showCommand}`);
			if (session.useCommand) lines.push(`    use:  ${session.useCommand}`);
		}
	} else {
		lines.push("Recent sessions: none");
	}
	if (summary.recentPrompts.length > 0) {
		lines.push("Recent prompts:");
		for (const prompt of summary.recentPrompts) {
			lines.push(`  ${prompt}`);
		}
	} else {
		lines.push("Recent prompts: none");
	}
	if (summary.finish.status === "none") {
		lines.push("Finish: none");
	} else {
		const lane = summary.finish.lane ? ` lane=${summary.finish.lane}` : "";
		const profile = summary.finish.profile
			? ` profile=${summary.finish.profile}`
			: "";
		lines.push(
			`Finish: ${summary.finish.status}${profile}${lane}${summary.finish.updatedAt ? ` updated=${summary.finish.updatedAt}` : ""}`,
		);
		if (summary.finish.failedStepId) {
			lines.push(`  failedStep: ${summary.finish.failedStepId}`);
		}
		if (summary.finish.failedCommand) {
			lines.push(`  failedCommand: ${summary.finish.failedCommand}`);
		}
		if (summary.finish.command) {
			lines.push(`  command: ${summary.finish.command}`);
		}
		for (const command of summary.finish.nextCommands) {
			lines.push(`  next: ${command}`);
		}
		if (summary.finish.remainingCommands.length > 0) {
			lines.push(`  remaining: ${summary.finish.remainingCommands.length} command${summary.finish.remainingCommands.length === 1 ? "" : "s"}`);
		}
	}

	if (summary.tasks.totalEfforts === 0) {
		lines.push("Tasks: no checkpoint");
		return lines.join("\n");
	}

	lines.push(
		`Tasks: ${summary.tasks.totalEfforts} recorded${summary.tasks.checkpointUpdatedAt ? ` updated=${summary.tasks.checkpointUpdatedAt}` : ""}`,
	);
	if (summary.tasks.activeEffort) {
		lines.push(
			`Active effort: ${summary.tasks.activeEffort.effortId} (${summary.tasks.activeEffort.transport})`,
		);
	}
	for (const effort of summary.tasks.recentEfforts) {
		const touched = effort.lastStatusAt ?? effort.lastLogAt ?? "-";
		lines.push(
			`  ${effort.effortId} status=${effort.lastStatus ?? "unknown"} transport=${effort.transport} touched=${touched}`,
		);
		const modelRoute = formatOperatorResumeModelRoute(effort.lastModelRoute);
		if (modelRoute) lines.push(`    model:  ${modelRoute}`);
		lines.push(`    status: ${effort.statusCommand}`);
		lines.push(`    logs:   ${effort.logsCommand}`);
	}
	return lines.join("\n");
}
