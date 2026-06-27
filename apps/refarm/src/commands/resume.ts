import { loadChatHistory } from "@refarm.dev/cli/chat-history";
import { buildJsonSuccessEnvelope, printJson } from "@refarm.dev/cli/json-output";
import {
	buildOperatorResumeEnvelope,
	buildOperatorResumeSummary,
	formatOperatorResumeSummary,
	type OperatorResumeModelSummary,
	type OperatorResumeProjectSummary,
	type OperatorResumeScheduledWorkInspection,
	type OperatorResumeSessionRecord,
} from "@refarm.dev/cli/operator-resume";
import {
	parseProjectHandoffSummary,
	PROJECT_HANDOFF_RELATIVE_PATH,
} from "@refarm.dev/cli/project-handoff";
import {
	inspectLocalScheduledWork,
	type LocalScheduledAutomation,
	type LocalScheduledTrigger,
} from "@refarm.dev/windmill/local-scheduler";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import {
	createAgentFinishSessionRecorder,
	type AgentFinishSessionRecorder,
} from "./agent-finish-session.js";
import {
	MODEL_CURRENT_JSON_COMMAND,
	MODEL_DOCTOR_JSON_COMMAND,
} from "./credential-handoffs.js";
import {
	buildCurrentModelStatus,
	defaultModelDeps,
	type ModelTokens,
} from "./model.js";
import { loadRecentRuntimeSessions } from "./session-history.js";
import { readActiveSessionId } from "./session-lock.js";
import {
	resolveStatusPayload,
	type ResolveStatusPayloadResult,
} from "./status.js";
import {
	createTaskSessionRecorder,
	type TaskSessionCheckpoint,
	type TaskSessionRecorder,
} from "./task-session.js";

export interface ResumeDeps {
	resolveStatusPayload(options: {
		renderer?: string;
	}): Promise<ResolveStatusPayloadResult>;
	sessionRecorder: TaskSessionRecorder;
	finishRecorder: AgentFinishSessionRecorder;
	readActiveSessionId(): string | null;
	loadRecentSessions(): Promise<OperatorResumeSessionRecord[]>;
	loadChatHistory(): string[];
	loadModelTokens(): Promise<ModelTokens>;
	loadProjectHandoff(): OperatorResumeProjectSummary | undefined;
	loadScheduledWork(): Promise<OperatorResumeScheduledWorkInspection | undefined>;
}

interface ProjectAutomationStore {
	automations?: unknown;
}

interface ProjectAutomationRecord {
	id?: unknown;
	name?: unknown;
	description?: unknown;
	status?: unknown;
	triggers?: unknown;
}

type ProjectAutomationForScheduler = LocalScheduledAutomation & {
	status: string;
};

interface LoadScheduledWorkOptions {
	now?: string | Date;
	owner?: string;
}

interface ResumeOptions {
	json?: boolean;
	status?: boolean;
	nextAction?: boolean;
	nextCommand?: boolean;
}

export function createResumeCommand(deps?: Partial<ResumeDeps>): Command {
	const resolvedDeps: ResumeDeps = {
		resolveStatusPayload,
		sessionRecorder: createTaskSessionRecorder(),
		finishRecorder: createAgentFinishSessionRecorder(),
		readActiveSessionId,
		loadRecentSessions: loadRecentRuntimeSessions,
		loadChatHistory,
		loadModelTokens: defaultModelDeps().loadTokens,
		loadProjectHandoff,
		loadScheduledWork,
		...deps,
	};

	return new Command("resume")
		.description(
			"Show the operator resume view across runtime and worker tasks",
		)
		.option("--json", "Print machine-readable JSON output")
		.option(
			"--no-status",
			"Skip runtime status inspection and only read local checkpoints",
		)
		.option("--next-action", "Print only the first recovery command and exit")
		.option("--next-command", "Alias for --next-action")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm resume
  $ refarm resume --json
  $ refarm resume --next-action
  $ refarm resume --next-action --json
  $ refarm resume --no-status

Notes:
  This is the operator-level "where was I?" view. It combines runtime status
  with local worker task checkpoints and prints the next useful commands.
  Use refarm task resume for the task-only checkpoint view.
`,
		)
		.action(async (options: ResumeOptions) => {
			await emitResume(options, resolvedDeps);
		});
}

async function emitResume(
	options: ResumeOptions,
	deps: ResumeDeps,
): Promise<void> {
	const taskCheckpoint = deps.sessionRecorder.getCheckpoint();
	const finish = deps.finishRecorder.getLatest();
	const activeSessionId = deps.readActiveSessionId();
	const recentPrompts = deps.loadChatHistory().slice(0, 5);
	const project = deps.loadProjectHandoff();
	const scheduledWork = await deps.loadScheduledWork();
	const model = await loadModelResumeSummary(deps);
	const recentSessions =
		options.status === false ? [] : await deps.loadRecentSessions();
	const statusResult =
		options.status === false
			? undefined
			: await deps.resolveStatusPayload({ renderer: "headless" });
	try {
		const status = statusResult?.json;
		const envelope = buildOperatorResumeEnvelope({
			status,
			model,
			project,
			scheduledWork,
			taskCheckpoint,
			activeSessionId,
			recentSessions,
			recentPrompts,
			finish,
		});

		const nextCommandMode = options.nextAction || options.nextCommand;
		if (nextCommandMode && options.json) {
			printJson(
				buildJsonSuccessEnvelope({
					command: "resume",
					operation: "operator",
					nextAction: envelope.nextAction,
					nextActions: envelope.nextActions,
					nextCommands: envelope.nextCommands,
					extra: {
						nextProcesses: envelope.nextProcesses,
					},
				}),
			);
			return;
		}
		if (nextCommandMode) {
			const [command] = envelope.nextCommands;
			if (command) {
				console.log(command);
			}
			return;
		}

		if (options.json) {
			printJson(envelope);
			return;
		}

		const summary = buildOperatorResumeSummary({
			status,
			model,
			project,
			scheduledWork,
			taskCheckpoint,
			activeSessionId,
			recentSessions,
			recentPrompts,
			finish,
		});
		console.log(formatOperatorResumeSummary(summary));
		const nextCommands = envelope.nextCommands;
		if (nextCommands.length > 0) {
			console.log("");
			console.log("Next commands:");
			for (const command of nextCommands) {
				console.log(`  ${command}`);
			}
		}
	} finally {
		await statusResult?.shutdown?.();
	}
}

export function loadProjectHandoff(
	cwd: string = process.cwd(),
): OperatorResumeProjectSummary | undefined {
	const handoffPath = path.join(cwd, PROJECT_HANDOFF_RELATIVE_PATH);
	try {
		return parseProjectHandoffSummary(
			JSON.parse(fs.readFileSync(handoffPath, "utf-8")),
			{ arrayLimit: 5 },
		);
	} catch {
		return undefined;
	}
}

export const PROJECT_AUTOMATIONS_RELATIVE_PATH = ".project/automations.json";

export async function loadScheduledWork(
	cwd: string = process.cwd(),
	options: LoadScheduledWorkOptions = {},
): Promise<OperatorResumeScheduledWorkInspection | undefined> {
	const automationsPath = path.join(cwd, PROJECT_AUTOMATIONS_RELATIVE_PATH);
	if (!fs.existsSync(automationsPath)) return undefined;

	let records: unknown;
	try {
		const parsed = JSON.parse(fs.readFileSync(automationsPath, "utf-8")) as
			| ProjectAutomationStore
			| unknown[];
		records = Array.isArray(parsed) ? parsed : parsed.automations;
	} catch {
		return undefined;
	}
	if (!Array.isArray(records)) return undefined;

	const automations = records.flatMap((record) => {
		const automation = normalizeProjectAutomation(record);
		return automation ? [automation] : [];
	});

	if (automations.length === 0) return undefined;

	return inspectLocalScheduledWork(
		{
			async query(filter?: { status?: string }) {
				if (!filter?.status) return automations;
				return automations.filter(
					(automation) => automation.status === filter.status,
				);
			},
		},
		{ owner: options.owner ?? "refarm-main", now: options.now },
	) as Promise<OperatorResumeScheduledWorkInspection>;
}

function normalizeProjectAutomation(
	record: unknown,
): ProjectAutomationForScheduler | undefined {
	if (!record || typeof record !== "object") return undefined;
	const automation = record as ProjectAutomationRecord;
	if (
		typeof automation.id !== "string" ||
		typeof automation.name !== "string" ||
		!Array.isArray(automation.triggers)
	) {
		return undefined;
	}

	const triggers = automation.triggers.flatMap((trigger) => {
		const normalized = normalizeScheduledTrigger(trigger);
		return normalized ? [normalized] : [];
	});
	if (triggers.length === 0) return undefined;

	return {
		id: automation.id,
		name: automation.name,
		description:
			typeof automation.description === "string"
				? automation.description
				: undefined,
		status: typeof automation.status === "string" ? automation.status : "draft",
		triggers,
	};
}

function normalizeScheduledTrigger(
	trigger: unknown,
): LocalScheduledTrigger | undefined {
	if (!trigger || typeof trigger !== "object") return undefined;
	const record = trigger as Record<string, unknown>;
	if (record.type === "once" && typeof record.at === "string") {
		return { type: "once", at: record.at };
	}
	if (record.type === "cron" && typeof record.schedule === "string") {
		return {
			type: "cron",
			schedule: record.schedule,
			timezone:
				typeof record.timezone === "string" ? record.timezone : undefined,
		};
	}
	return undefined;
}

async function loadModelResumeSummary(
	deps: Pick<ResumeDeps, "loadModelTokens">,
): Promise<OperatorResumeModelSummary | undefined> {
	try {
		const tokens = await deps.loadModelTokens();
		const status = buildCurrentModelStatus(tokens);
		return {
			current: {
				scope: "default",
				provider: status.current.provider,
				modelId: status.current.modelId,
				ref: status.current.ref,
			},
			routes: status.routes,
			credential: {
				state: status.credential.state,
				status: status.credential.status,
				envKey: status.credential.envKey,
			},
			source: status.source.kind,
			inspectCommand: MODEL_CURRENT_JSON_COMMAND,
			doctorCommand: MODEL_DOCTOR_JSON_COMMAND,
		};
	} catch {
		return undefined;
	}
}

export type { TaskSessionCheckpoint };

export const resumeCommand = createResumeCommand();
