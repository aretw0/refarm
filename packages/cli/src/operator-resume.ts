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
}

export interface OperatorResumeInput {
	status?: RefarmStatusJson;
	taskCheckpoint?: OperatorResumeTaskCheckpoint | null;
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

export interface OperatorResumeSummary {
	status: "empty" | "ok";
	runtime?: OperatorResumeRuntimeSummary;
	tasks: OperatorResumeTaskSummary;
}

export type OperatorResumeEnvelope =
	JsonSuccessEnvelope<OperatorResumeSummary>;

const DEFAULT_OPERATOR_RESUME_COMMANDS: OperatorResumeCommands = {
	runtimeDoctor: "refarm runtime doctor --next-command",
	taskList: "refarm task list --json",
};

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
	return {
		status: runtime || efforts.length > 0 ? "ok" : "empty",
		runtime,
		tasks,
	};
}

export function operatorResumeNextCommands(
	summary: OperatorResumeSummary,
	commands: Partial<OperatorResumeCommands> = {},
): string[] {
	const resolved = { ...DEFAULT_OPERATOR_RESUME_COMMANDS, ...commands };
	const nextCommands: string[] = [];
	if (summary.runtime && !summary.runtime.ready) {
		nextCommands.push(resolved.runtimeDoctor);
	}
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
