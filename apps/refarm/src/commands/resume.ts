import {
	buildOperatorResumeEnvelope,
	buildOperatorResumeSummary,
	formatOperatorResumeSummary,
	type OperatorResumeModelSummary,
	type OperatorResumeSessionRecord,
} from "@refarm.dev/cli/operator-resume";
import { Command } from "commander";
import {
	createAgentFinishSessionRecorder,
	type AgentFinishSessionRecorder,
} from "./agent-finish-session.js";
import { loadChatHistory } from "./chat-history.js";
import {
	MODEL_CURRENT_JSON_COMMAND,
	MODEL_DOCTOR_JSON_COMMAND,
} from "./credential-handoffs.js";
import { printJson, buildJsonSuccessEnvelope } from "./json-output.js";
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
