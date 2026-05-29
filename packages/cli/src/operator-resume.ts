import { applicationCommand } from "./command-handoff.js";
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
	modelCurrent: string;
	sessionShow: (sessionId: string) => string;
}

export interface OperatorResumeSessionRecord {
	sessionId: string;
	shortId?: string;
	name?: string | null;
	createdAtNs?: number | null;
	hasHistory?: boolean;
	showCommand?: string;
	useCommand?: string;
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
}

export interface OperatorResumeSessionSummary {
	status: "none" | "active";
	activeSessionId?: string;
	shortId?: string;
	showCommand?: string;
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
	JsonSuccessEnvelope<OperatorResumeSummary>;

function refarmAppCommand(args: string[]): string {
	return applicationCommand("refarm", args);
}

const DEFAULT_OPERATOR_RESUME_COMMANDS: OperatorResumeCommands = {
	runtimeDoctor: refarmAppCommand(["runtime", "doctor", "--next-command"]),
	taskList: refarmAppCommand(["task", "list", "--json"]),
	modelCurrent: refarmAppCommand(["model", "current", "--json"]),
	sessionShow: (sessionId) =>
		refarmAppCommand([
			"tree",
			"show",
			formatOperatorResumeSessionId(sessionId),
			"--json",
		]),
};

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
	const sessionShowCommand = input.activeSessionId
		? (input.commands?.sessionShow ?? DEFAULT_OPERATOR_RESUME_COMMANDS.sessionShow)(
				input.activeSessionId,
			)
		: undefined;
	const session: OperatorResumeSessionSummary = {
		status: input.activeSessionId ? "active" : "none",
		activeSessionId: input.activeSessionId ?? undefined,
		shortId: input.activeSessionId
			? formatOperatorResumeSessionId(input.activeSessionId)
			: undefined,
		showCommand: sessionShowCommand,
		recentSessions: (input.recentSessions ?? []).slice(0, 5),
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
				session.status === "active" ||
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

	// Model: only surface when credentials are missing, not on every resume.
	if (summary.model?.credential?.state === "missing") {
		nextCommands.push(
			summary.model.inspectCommand ?? resolved.modelCurrent,
		);
	}

	// Task: active effort takes priority over generic list.
	if (summary.tasks.activeEffort) {
		nextCommands.push(
			`${summary.tasks.activeEffort.statusCommand} --watch`,
			summary.tasks.activeEffort.logsCommand,
		);
	} else {
		nextCommands.push(resolved.taskList);
	}

	return [...new Set(nextCommands)];
}

export function buildOperatorResumeEnvelope(
	input: OperatorResumeInput,
): OperatorResumeEnvelope {
	const summary = buildOperatorResumeSummary(input);
	const nextCommands = operatorResumeNextCommands(summary, input.commands);
	return buildJsonSuccessEnvelope<OperatorResumeSummary>({
		command: "resume",
		operation: "operator",
		nextActions: nextCommands,
		nextCommands,
		extra: summary,
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
	} else {
		lines.push("Model: not inspected");
	}
	if (summary.session.status === "active" && summary.session.activeSessionId) {
		lines.push(
			`Session: active=${summary.session.shortId ?? summary.session.activeSessionId}`,
		);
		if (summary.session.showCommand) {
			lines.push(`  show: ${summary.session.showCommand}`);
		}
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
