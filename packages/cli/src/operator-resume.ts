import {
	buildJsonSuccessEnvelope,
	type JsonSuccessEnvelope,
} from "@refarm.dev/capabilities/envelope";
import {
	applicationCommand,
	applicationProcess,
	type ApplicationProcessSpec,
} from "./command-handoff.js";
import type { ProjectHandoffFieldCount, ProjectHandoffTruncation } from "./project-handoff.js";
import type { StatusJson } from "./status.js";

// Re-exported alongside `OperatorResumeProjectSummary` (below) so consumers of
// this module's `truncation` field don't need a second import path.
export type { ProjectHandoffFieldCount, ProjectHandoffTruncation };

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
	/** The app binary these commands were built for (ADR-087) — lets consumers
	 *  recognize "one of ours" without this package naming any brand. */
	binary: string;
	runtimeDoctor: string;
	taskList: string;
	taskResume: string;
	modelCurrent: string;
	sessionClear: string;
	sessionList: string;
	sessionShow: (sessionId: string) => string;
}

/** The process-spec twin of {@link OperatorResumeCommands} (spawnable form). */
export interface OperatorResumeProcesses {
	runtimeDoctor: ApplicationProcessSpec;
	taskList: ApplicationProcessSpec;
	taskResume: ApplicationProcessSpec;
	modelCurrent: ApplicationProcessSpec;
	sessionClear: ApplicationProcessSpec;
	sessionList: ApplicationProcessSpec;
	sessionShow: (sessionId: string) => ApplicationProcessSpec;
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

export interface OperatorResumeScheduledWorkSummary {
	total: number;
	due: number;
	/** Trigger condition not yet met: the declaration exists and is valid, but
	 *  nothing has fired it. Not "scheduled" — this codebase has no autonomous
	 *  loop that watches the clock and fires it; only an explicit tick does. */
	declared: number;
	unsupported: number;
}

export interface OperatorResumeScheduledWorkJob {
	id: string;
	automationId: string;
	name: string;
	owner: string;
	kind: "one-shot" | "recurring";
	status: "due" | "declared" | "unsupported";
	schedule: {
		type: string;
		at?: string;
		schedule?: string;
		timezone?: string;
	};
	unsupportedReason?: string;
	modelRoute: "none" | string;
	tokenUse: "none" | string;
	resume?: {
		visible: boolean;
		summary?: string;
	};
}

export interface OperatorResumeScheduledWorkInspection {
	schemaVersion: number;
	owner: string;
	generatedAt: string;
	summary: OperatorResumeScheduledWorkSummary;
	jobs: readonly OperatorResumeScheduledWorkJob[];
}

export interface OperatorResumeEnvironmentPressureSignal {
	id: string;
	kind: string;
	severity: "info" | "warning" | "failure";
	ok: boolean;
	summary: string;
	action: string | null;
	command?: string | null;
	path?: string;
}

export interface OperatorResumeEnvironmentPressure {
	command: string;
	operation: string;
	ok: boolean;
	decision: "continue" | "safe-mode" | "stop-and-investigate";
	signals: readonly OperatorResumeEnvironmentPressureSignal[];
	nextCommands: readonly string[];
}

export interface OperatorResumeInput {
	status?: StatusJson;
	model?: OperatorResumeModelSummary;
	project?: OperatorResumeProjectSummary | null;
	taskCheckpoint?: OperatorResumeTaskCheckpoint | null;
	activeSessionId?: string | null;
	recentSessions?: readonly OperatorResumeSessionRecord[];
	recentPrompts?: readonly string[];
	finish?: OperatorResumeFinishRecord | null;
	scheduledWork?: OperatorResumeScheduledWorkInspection | null;
	environmentPressure?: OperatorResumeEnvironmentPressure | null;
	/** The app-supplied handoff set (ADR-087) — commands + processes + dynamic
	 *  builder for the app's binary. Required: the package names no binary. */
	handoffs: OperatorResumeHandoffs;
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
	engine?: StatusJson["runtime"]["engine"];
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

export interface OperatorResumeProjectSummary {
	path: string;
	timestamp?: string;
	currentPhase?: string | number;
	context?: string;
	currentTasks: readonly string[];
	blockers: readonly string[];
	nextActions: readonly string[];
	openQuestions: readonly string[];
	/** How much of each list was cut by the read limit, counted before blanks are
	 *  dropped so whitespace is never reported as hidden content — a truncated
	 *  read must declare itself instead of looking complete. */
	truncation: ProjectHandoffTruncation;
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
	project?: OperatorResumeProjectSummary;
	scheduledWork?: OperatorResumeScheduledWorkInspection;
	environmentPressure?: OperatorResumeEnvironmentPressure;
	session: OperatorResumeSessionSummary;
	recentPrompts: readonly string[];
	finish: OperatorResumeFinishSummary;
	tasks: OperatorResumeTaskSummary;
}

export type OperatorResumeEnvelope = JsonSuccessEnvelope<
	OperatorResumeSummary & { nextProcesses: readonly ApplicationProcessSpec[] }
>;

/** The complete operator-resume handoff set for one binary: the string commands,
 *  their spawnable process twins, and the builder for dynamic per-effort processes.
 *  The app builds this once (via {@link buildOperatorResumeCommands}) and hands it
 *  in — the generic package never names a binary. */
export interface OperatorResumeHandoffs {
	commands: OperatorResumeCommands;
	processes: OperatorResumeProcesses;
	/** Builds a dynamic process spec (task status/logs) for the same binary. */
	processBuilder: (args: string[]) => ApplicationProcessSpec;
}

/**
 * Build the complete operator-resume handoffs for a given binary (ADR-087). The
 * generic package must not name the app's binary, so it takes the neutral
 * `applicationCommand`/`applicationProcess` and the binary as arguments; the app
 * calls this with its own name (a white-label app its own). REQUIRED — no default
 * binary; a caller that needs it configures it, or it fails up.
 */
export function buildOperatorResumeCommands(binary: string): OperatorResumeHandoffs {
	const cmd = (args: string[]) => applicationCommand(binary, args);
	const proc = (args: string[]) => applicationProcess(binary, args);
	// One args table drives both the string and the process form — no duplication.
	const ARGS = {
		runtimeDoctor: ["doctor", "--next-command"],
		taskList: ["task", "list", "--json"],
		taskResume: ["task", "resume", "--json"],
		modelCurrent: ["model", "current", "--json"],
		sessionClear: ["sessions", "clear", "--json"],
		sessionList: ["sessions", "list", "--json"],
	} satisfies Record<string, string[]>;
	const sessionShowArgs = (sessionId: string) => [
		"sessions",
		"show",
		formatOperatorResumeSessionId(sessionId),
		"--json",
	];
	const mapArgs = <T>(fn: (args: string[]) => T) => ({
		runtimeDoctor: fn(ARGS.runtimeDoctor),
		taskList: fn(ARGS.taskList),
		taskResume: fn(ARGS.taskResume),
		modelCurrent: fn(ARGS.modelCurrent),
		sessionClear: fn(ARGS.sessionClear),
		sessionList: fn(ARGS.sessionList),
		sessionShow: (sessionId: string) => fn(sessionShowArgs(sessionId)),
	});
	return {
		commands: { binary, ...mapArgs(cmd) },
		processes: mapArgs(proc),
		processBuilder: proc,
	};
}

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

function taskJsonRecord(effort: OperatorResumeTaskRecord): OperatorResumeTaskRecord {
	return {
		...effort,
		statusCommand: taskReadJsonCommand(effort.statusCommand),
		logsCommand: taskReadJsonCommand(effort.logsCommand),
	};
}

function taskJsonSummary(tasks: OperatorResumeTaskSummary): OperatorResumeTaskSummary {
	const recentEfforts = tasks.recentEfforts.map(taskJsonRecord);
	return {
		...tasks,
		activeEffort: tasks.activeEffort ? taskJsonRecord(tasks.activeEffort) : undefined,
		recentEfforts,
	};
}

function isApplicationResumeCommand(command: string, binary: string): boolean {
	return command.trim().startsWith(`${binary} `);
}

function isTerminalTaskStatus(status: string | undefined): boolean {
	return (
		status === "done" ||
		status === "delivered" ||
		status === "partial" ||
		status === "failed" ||
		status === "timed-out" ||
		status === "cancelled" ||
		status === "not-found"
	);
}

function hasResumableTaskEffort(tasks: OperatorResumeTaskSummary): boolean {
	return tasks.recentEfforts.some((effort) => !isTerminalTaskStatus(effort.lastStatus));
}

function operatorResumeJsonSummary(summary: OperatorResumeSummary): OperatorResumeSummary {
	return {
		...summary,
		tasks: taskJsonSummary(summary.tasks),
	};
}

function operatorResumeParticipantDisplay(
	record:
		| OperatorResumeSessionSummary
		| Pick<OperatorResumeSessionRecord, "canonicalParticipants" | "participantAliases">,
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
			: (route.provider ?? route.modelId));
	if (route.scope && ref) return `${route.scope} ${ref}`;
	return route.scope ?? ref;
}

export function buildOperatorResumeSummary(input: OperatorResumeInput): OperatorResumeSummary {
	const efforts = input.taskCheckpoint?.efforts ?? [];
	const activeEffort = input.taskCheckpoint?.activeEffortId
		? efforts.find((effort) => effort.effortId === input.taskCheckpoint?.activeEffortId)
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
					session.sessionId === input.activeSessionId || session.shortId === activeShortId,
			)
		: undefined;
	const sessionStatus = input.activeSessionId ? (activeRecentSession ? "active" : "stale") : "none";
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
		status:
			runtime ||
			Boolean(input.model) ||
			Boolean(input.project) ||
			Boolean(input.scheduledWork) ||
			Boolean(input.environmentPressure) ||
			session.status !== "none" ||
			session.recentSessions.length > 0 ||
			efforts.length > 0 ||
			(input.recentPrompts?.length ?? 0) > 0 ||
			finish.status !== "none"
				? "ok"
				: "empty",
		runtime,
		model: input.model,
		project: input.project ?? undefined,
		scheduledWork: input.scheduledWork ?? undefined,
		environmentPressure: input.environmentPressure ?? undefined,
		session,
		recentPrompts: (input.recentPrompts ?? []).slice(0, 5),
		finish,
		tasks,
	};
}

export function operatorResumeNextCommands(
	summary: OperatorResumeSummary,
	commands: OperatorResumeCommands,
): string[] {
	const resolved = commands;

	// Emergency: runtime not ready — fix that first, everything else is noise.
	if (summary.runtime && !summary.runtime.ready) {
		const recovery = summary.finish.status === "failed" ? summary.finish.nextCommands : [];
		return [...new Set([resolved.runtimeDoctor, ...recovery])];
	}

	const nextCommands: string[] = [];

	if (summary.environmentPressure?.decision === "stop-and-investigate") {
		nextCommands.push(
			...summary.environmentPressure.nextCommands.filter((command) =>
				isApplicationResumeCommand(command, resolved.binary),
			),
		);
		return [...new Set(nextCommands)];
	}

	// Recovery: finish failed — the most urgent resumption point.
	if (summary.finish.status === "failed") {
		nextCommands.push(...summary.finish.nextCommands);
	}

	// Sessions are context, not unfinished work. Only repair a dangling pointer;
	// an existing active pointer must not commandeer an unrelated operator slice.
	if (summary.session.status === "stale") {
		nextCommands.push(resolved.sessionClear);
		nextCommands.push(resolved.sessionList);
	}

	// Model: only surface when credentials are missing, not on every resume.
	if (summary.model?.credential?.state === "missing") {
		nextCommands.push(summary.model.inspectCommand ?? resolved.modelCurrent);
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

export function operatorResumeNextActions(summary: OperatorResumeSummary): string[] {
	if (summary.runtime && !summary.runtime.ready) return ["Restore runtime readiness."];
	if (summary.environmentPressure?.decision === "stop-and-investigate") {
		return ["Investigate the reported environment pressure before continuing."];
	}

	const actions: string[] = [];
	if (summary.finish.status === "failed") actions.push("Complete the failed validation handoff.");
	if (summary.session.status === "stale") actions.push("Repair the stale active-session pointer.");
	if (summary.model?.credential?.state === "missing") {
		actions.push("Configure the missing model credential.");
	}
	if (summary.tasks.activeEffort) actions.push("Continue the active task effort.");
	else if (hasResumableTaskEffort(summary.tasks)) actions.push("Resume unfinished task work.");
	else if (summary.tasks.totalEfforts === 0) actions.push("Inspect available task efforts.");
	return [...new Set(actions)];
}

function commandProcessKey(processSpec: ApplicationProcessSpec): string {
	return `${processSpec.command}\0${processSpec.args.join("\0")}`;
}

function dedupeCommandProcesses(processes: ApplicationProcessSpec[]): ApplicationProcessSpec[] {
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
	handoffs: OperatorResumeHandoffs,
): ApplicationProcessSpec[] {
	const { commands, processes, processBuilder } = handoffs;
	const nextCommands = operatorResumeNextCommands(summary, commands);
	const processByCommand = new Map<string, ApplicationProcessSpec>();
	const addDefaultProcess = (command: string, processSpec: ApplicationProcessSpec): void => {
		processByCommand.set(command, processSpec);
	};

	addDefaultProcess(commands.runtimeDoctor, processes.runtimeDoctor);
	addDefaultProcess(commands.taskList, processes.taskList);
	addDefaultProcess(commands.taskResume, processes.taskResume);
	addDefaultProcess(commands.modelCurrent, processes.modelCurrent);
	addDefaultProcess(commands.sessionClear, processes.sessionClear);
	addDefaultProcess(commands.sessionList, processes.sessionList);
	for (const session of summary.session.recentSessions) {
		if (session.showCommand) {
			addDefaultProcess(session.showCommand, processes.sessionShow(session.sessionId));
		}
	}
	if (summary.session.activeSessionId && summary.session.showCommand) {
		addDefaultProcess(
			summary.session.showCommand,
			processes.sessionShow(summary.session.activeSessionId),
		);
	}
	if (summary.tasks.activeEffort) {
		const effort = summary.tasks.activeEffort;
		// Both the status(--watch) and logs processes share the same task/effort/
		// transport shape — centralized so the args aren't duplicated.
		const taskEffortProcess = (verb: string, extraFlags: string[]) =>
			processBuilder([
				"task",
				verb,
				effort.effortId,
				"--transport",
				effort.transport,
				...extraFlags,
				"--json",
			]);
		addDefaultProcess(taskWatchJsonCommand(effort.statusCommand), {
			...taskEffortProcess("status", ["--watch"]),
		});
		addDefaultProcess(taskReadJsonCommand(effort.logsCommand), {
			...taskEffortProcess("logs", []),
		});
	}

	return dedupeCommandProcesses(
		nextCommands
			.map((command) => processByCommand.get(command))
			.filter((processSpec): processSpec is ApplicationProcessSpec => processSpec !== undefined),
	);
}

export function buildOperatorResumeEnvelope(input: OperatorResumeInput): OperatorResumeEnvelope {
	const summary = buildOperatorResumeSummary(input);
	const nextActions = operatorResumeNextActions(summary);
	const nextCommands = operatorResumeNextCommands(summary, input.handoffs.commands);
	const nextProcesses = operatorResumeNextProcesses(summary, input.handoffs);
	return buildJsonSuccessEnvelope<
		OperatorResumeSummary & { nextProcesses: readonly ApplicationProcessSpec[] }
	>({
		command: "resume",
		operation: "operator",
		nextActions,
		nextCommands,
		extra: {
			...operatorResumeJsonSummary(summary),
			nextProcesses,
		},
	});
}

export function formatOperatorResumeSummary(summary: OperatorResumeSummary): string {
	const lines: string[] = [];
	lines.push("Operator resume");
	if (summary.runtime) {
		const engine = summary.runtime.engine ? ` engine=${summary.runtime.engine.activeEngine}` : "";
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
	if (summary.project) {
		const phase =
			summary.project.currentPhase !== undefined ? ` phase=${summary.project.currentPhase}` : "";
		const timestamp = summary.project.timestamp ? ` timestamp=${summary.project.timestamp}` : "";
		lines.push(`Project handoff: ${summary.project.path}${phase}${timestamp}`);
		if (summary.project.context) {
			lines.push(`  context: ${truncateResumeText(summary.project.context, 180)}`);
		}
		for (const task of summary.project.currentTasks) {
			lines.push(`  current: ${task}`);
		}
		for (const action of summary.project.nextActions) {
			lines.push(`  next: ${action}`);
		}
		for (const blocker of summary.project.blockers) {
			lines.push(`  blocker: ${blocker}`);
		}
		for (const question of summary.project.openQuestions) {
			lines.push(`  question: ${question}`);
		}
	} else {
		lines.push("Project handoff: none");
	}
	if (summary.scheduledWork) {
		const { summary: scheduledSummary } = summary.scheduledWork;
		lines.push(
			`Scheduled work: ${scheduledSummary.total} local job${scheduledSummary.total === 1 ? "" : "s"} due=${scheduledSummary.due} declared=${scheduledSummary.declared} unsupported=${scheduledSummary.unsupported}`,
		);
		lines.push(`  owner: ${summary.scheduledWork.owner}`);
		for (const job of summary.scheduledWork.jobs.slice(0, 10)) {
			const schedule = formatScheduledWorkSchedule(job);
			lines.push(
				`  ${job.id} ${job.status} ${job.kind} ${job.name}${schedule ? ` ${schedule}` : ""}`,
			);
			if (job.resume?.summary) {
				lines.push(`    resume: ${job.resume.summary}`);
			}
			if (job.unsupportedReason) {
				lines.push(`    unsupported: ${job.unsupportedReason}`);
			}
		}
	} else {
		lines.push("Scheduled work: none");
	}
	if (summary.environmentPressure) {
		lines.push(
			`Environment pressure: ${summary.environmentPressure.decision} (${summary.environmentPressure.signals.length} signals)`,
		);
		for (const signal of summary.environmentPressure.signals
			.filter((signal) => signal.severity !== "info")
			.slice(0, 5)) {
			lines.push(`  ${signal.severity}: ${signal.summary}`);
			if (signal.action) lines.push(`    action: ${signal.action}`);
			if (signal.command) lines.push(`    command: ${signal.command}`);
		}
	} else {
		lines.push("Environment pressure: not inspected");
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
			const active = session.sessionId === summary.session.activeSessionId ? " *" : "";
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
		const profile = summary.finish.profile ? ` profile=${summary.finish.profile}` : "";
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
			lines.push(
				`  remaining: ${summary.finish.remainingCommands.length} command${summary.finish.remainingCommands.length === 1 ? "" : "s"}`,
			);
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

function formatScheduledWorkSchedule(job: OperatorResumeScheduledWorkJob): string | undefined {
	if (job.schedule.type === "once" && job.schedule.at) {
		return `at=${job.schedule.at}`;
	}
	if (job.schedule.type === "cron" && job.schedule.schedule) {
		return `cron=${job.schedule.schedule}${job.schedule.timezone ? ` timezone=${job.schedule.timezone}` : ""}`;
	}
	return undefined;
}

function truncateResumeText(value: string, maxLength: number): string {
	return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}
