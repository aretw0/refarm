import {
	buildOperatorResumeEnvelope,
	buildOperatorResumeSummary,
	formatOperatorResumeSummary,
} from "@refarm.dev/cli/operator-resume";
import { Command } from "commander";
import { printJson } from "./json-output.js";
import {
	resolveStatusPayload,
	type ResolveStatusPayloadResult,
} from "./status.js";
import { readActiveSessionId } from "./session-lock.js";
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
	readActiveSessionId(): string | null;
}

interface ResumeOptions {
	json?: boolean;
	status?: boolean;
}

export function createResumeCommand(deps?: Partial<ResumeDeps>): Command {
	const resolvedDeps: ResumeDeps = {
		resolveStatusPayload,
		sessionRecorder: createTaskSessionRecorder(),
		readActiveSessionId,
		...deps,
	};

	return new Command("resume")
		.description("Show the operator resume view across runtime and worker tasks")
		.option("--json", "Print machine-readable JSON output")
		.option(
			"--no-status",
			"Skip runtime status inspection and only read local checkpoints",
		)
		.addHelpText(
			"after",
			`

Examples:
  $ refarm resume
  $ refarm resume --json
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

async function emitResume(options: ResumeOptions, deps: ResumeDeps): Promise<void> {
	const taskCheckpoint = deps.sessionRecorder.getCheckpoint();
	const activeSessionId = deps.readActiveSessionId();
	const statusResult = options.status === false
		? undefined
		: await deps.resolveStatusPayload({ renderer: "headless" });
	try {
		const status = statusResult?.json;

		if (options.json) {
			printJson(
				buildOperatorResumeEnvelope({
					status,
					taskCheckpoint,
					activeSessionId,
				}),
			);
			return;
		}

		const summary = buildOperatorResumeSummary({
			status,
			taskCheckpoint,
			activeSessionId,
		});
		console.log(formatOperatorResumeSummary(summary));
		const nextCommands = buildOperatorResumeEnvelope({
			status,
			taskCheckpoint,
			activeSessionId,
		}).nextCommands;
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

export type { TaskSessionCheckpoint };

export const resumeCommand = createResumeCommand();
