import { isPiAgentPluginId } from "@refarm.dev/config";
import type {
	Effort,
	EffortLogEntry,
	EffortResult,
	EffortSummary,
	EffortTransportAdapter,
} from "@refarm.dev/effort-contract-v1";
import chalk from "chalk";
import { Command, InvalidArgumentError } from "commander";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { quoteCommandArg, refarmCommand } from "./command-handoff.js";
import {
	MODEL_CURRENT_JSON_COMMAND,
	RESUME_JSON_COMMAND,
} from "./credential-handoffs.js";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "./json-output.js";
import {
	RUNTIME_DOCTOR_COMMAND,
	RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
	RUNTIME_DOCTOR_NEXT_COMMAND,
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
	RUNTIME_STATUS_COMMAND
} from "./runtime-recovery.js";
import { resolveSidecarUrl } from "./sidecar-url.js";
import {
	buildTaskEffortCommands,
	buildTaskLogsCommand,
	buildTaskStatusCommand,
	createTaskSessionRecorder,
	formatTaskSessionModelRoute,
	taskSessionEffortCommands,
	type TaskSessionCheckpoint,
	type TaskSessionRecorder,
} from "./task-session.js";
import { isFinalEffortStatus } from "./task-status.js";

interface TaskOperationsAdapter extends EffortTransportAdapter {
	list(): Promise<EffortResult[]>;
	logs(effortId: string): Promise<EffortLogEntry[] | null>;
	retry(effortId: string): Promise<boolean>;
	cancel(effortId: string): Promise<boolean>;
	summary(): Promise<EffortSummary>;
}

const TASK_TRANSPORTS = ["file", "http"] as const;
type TaskTransport = (typeof TASK_TRANSPORTS)[number];

function parseTaskTransport(value: string): TaskTransport {
	if ((TASK_TRANSPORTS as readonly string[]).includes(value)) {
		return value as TaskTransport;
	}
	throw new InvalidArgumentError(
		`Invalid task transport "${value}". Use: ${TASK_TRANSPORTS.join(", ")}`,
	);
}

function parsePositiveIntOption(value: string, label: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new InvalidArgumentError(`${label} must be a positive integer.`);
	}
	return parsed;
}

function formatLogMeta(meta: Record<string, unknown> | undefined): string {
	if (!meta) return "";
	const modelScope = typeof meta.modelScope === "string" ? meta.modelScope : undefined;
	const modelProvider = typeof meta.modelProvider === "string" ? meta.modelProvider : undefined;
	const modelId = typeof meta.modelId === "string" ? meta.modelId : undefined;
	const modelRoute = modelProvider && modelId
		? `${modelProvider}/${modelId}`
		: modelProvider ?? modelId;
	const parts = [
		modelScope ? `scope=${modelScope}` : undefined,
		modelRoute ? `model=${modelRoute}` : undefined,
	].filter((part): part is string => Boolean(part));
	return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function baseSummary(): EffortSummary {
	return {
		total: 0,
		pending: 0,
		inProgress: 0,
		done: 0,
		partial: 0,
		failed: 0,
		timedOut: 0,
		cancelled: 0,
	};
}

function formatAgeSeconds(submittedAt?: string): string {
	if (!submittedAt) return "-";
	const submittedMs = Date.parse(submittedAt);
	if (Number.isNaN(submittedMs)) return "-";
	return `${Math.max(0, Math.floor((Date.now() - submittedMs) / 1000))}s`;
}

const AGENT_ERROR_PREFIXES = ["[pi-agent erro]", "[pi-agent stub]", "[budget]"];

function parseTaskResultPayload(result: unknown): unknown {
	if (typeof result !== "string") return result;
	try {
		return JSON.parse(result) as unknown;
	} catch {
		return result;
	}
}

function taskResultContent(result: unknown): string | null {
	const payload = parseTaskResultPayload(result);
	if (typeof payload === "string") return payload;
	if (Array.isArray(payload)) {
		const [content] = payload;
		return typeof content === "string" ? content : null;
	}
	if (payload && typeof payload === "object") {
		const content = (payload as { content?: unknown }).content;
		return typeof content === "string" ? content : null;
	}
	return null;
}

function taskResultObservedError(result: unknown): string | null {
	const content = taskResultContent(result);
	if (!content) return null;
	return AGENT_ERROR_PREFIXES.some((prefix) => content.startsWith(prefix))
		? content
		: null;
}

function taskResultObservedStatus(taskResult: EffortResult["results"][number]): string {
	if (taskResult.status !== "ok") return taskResult.status;
	return taskResultObservedError(taskResult.result) ? "error" : taskResult.status;
}

function effortObservedStatus(result: EffortResult): EffortResult["status"] {
	if (result.status !== "done") return result.status;
	return result.results.some((taskResult) => taskResultObservedStatus(taskResult) === "error")
		? "failed"
		: result.status;
}

function printTaskJsonSuccess<TExtra extends object>(
	operation: string,
	extra: TExtra,
	nextCommands: string[] = [],
): void {
	printJson(
		buildJsonSuccessEnvelope({
			command: "task",
			operation,
			extra,
			nextActions: nextCommands,
			nextCommands,
		}),
	);
}

function taskCheckpointJsonHandoff(
	checkpoint: TaskSessionCheckpoint,
): TaskSessionCheckpoint {
	return {
		...checkpoint,
		efforts: checkpoint.efforts.map((effort) => ({
			...effort,
			statusCommand: buildTaskStatusCommand(effort.effortId, effort.transport, {
				json: true,
			}),
			logsCommand: buildTaskLogsCommand(effort.effortId, effort.transport, {
				json: true,
			}),
		})),
	};
}

function reportTaskControlError(
	operation: "retry" | "cancel",
	effortId: string,
	transport: TaskTransport,
	err: unknown,
	opts: { json?: boolean },
): void {
	const message = err instanceof Error ? err.message : String(err);
	const statusCommand = buildTaskStatusCommand(effortId, transport);
	if (opts.json) {
		printJson(
			buildJsonErrorEnvelope({
				command: "task",
				operation,
				error: `task-${operation}-failed`,
				message,
				nextAction: statusCommand,
				nextActions: [statusCommand, RUNTIME_DOCTOR_NEXT_ACTION_COMMAND],
				nextCommand: statusCommand,
				nextCommands: [
					statusCommand,
					RUNTIME_DOCTOR_NEXT_COMMAND,
					RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
				],
				extra: {
					effortId,
					transport,
					action: operation,
					accepted: false,
				},
			}),
		);
		process.exitCode = 1;
		return;
	}
	console.error(
		chalk.red(
			`${operation === "retry" ? "Retry" : "Cancel"} failed for effort ${effortId}: ${message}`,
		),
	);
	console.error(chalk.dim(`  Status:   ${statusCommand}`));
	console.error(chalk.dim(`  Diagnose: ${RUNTIME_DOCTOR_COMMAND}`));
	process.exitCode = 1;
}

function reportTaskReadError(
	operation: "status" | "logs",
	effortId: string,
	transport: TaskTransport,
	err: unknown,
	opts: { json?: boolean },
): void {
	const message = err instanceof Error ? err.message : String(err);
	const statusCommand = buildTaskStatusCommand(effortId, transport);
	const logsCommand = buildTaskLogsCommand(effortId, transport);
	const nextCommands =
		operation === "logs"
			? [statusCommand, RUNTIME_DOCTOR_NEXT_COMMAND]
			: [RUNTIME_DOCTOR_NEXT_COMMAND, RUNTIME_ENSURE_WAIT_NEXT_COMMAND];
	if (opts.json) {
		printJson(
			buildJsonErrorEnvelope({
				command: "task",
				operation,
				error: `task-${operation}-failed`,
				message,
				nextAction:
					operation === "logs"
						? statusCommand
						: RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
				nextActions:
					operation === "logs"
						? [statusCommand, RUNTIME_DOCTOR_NEXT_ACTION_COMMAND]
						: [RUNTIME_DOCTOR_NEXT_ACTION_COMMAND, RUNTIME_STATUS_COMMAND],
				nextCommand: nextCommands[0],
				nextCommands,
				extra: {
					effortId,
					transport,
					...(operation === "status" ? { logsCommand } : { statusCommand }),
				},
			}),
		);
		process.exitCode = 1;
		return;
	}
	console.error(
		chalk.red(
			`${operation === "status" ? "Status" : "Logs"} failed for effort ${effortId}: ${message}`,
		),
	);
	console.error(chalk.dim(`  Diagnose: ${RUNTIME_DOCTOR_COMMAND}`));
	process.exitCode = 1;
}

function buildTaskRunCommand(
	plugin: string,
	fn: string,
	options: { transport: string; json?: boolean } = { transport: "file" },
): string {
	return refarmCommand([
		"task",
		"run",
		quoteCommandArg(plugin),
		quoteCommandArg(fn),
		"--args",
		quoteCommandArg("{}"),
		"--transport",
		options.transport,
		...(options.json ? ["--json"] : []),
	]);
}

class FileTransportClient implements TaskOperationsAdapter {
	private readonly tasksDir: string;
	private readonly resultsDir: string;
	private readonly logsDir: string;
	private readonly controlDir: string;

	constructor(baseDir: string) {
		this.tasksDir = path.join(baseDir, "tasks");
		this.resultsDir = path.join(baseDir, "task-results");
		this.logsDir = path.join(baseDir, "task-logs");
		this.controlDir = path.join(baseDir, "task-control");
		fs.mkdirSync(this.tasksDir, { recursive: true });
		fs.mkdirSync(this.resultsDir, { recursive: true });
		fs.mkdirSync(this.logsDir, { recursive: true });
		fs.mkdirSync(this.controlDir, { recursive: true });
	}

	async submit(effort: Effort): Promise<string> {
		fs.writeFileSync(
			path.join(this.tasksDir, `${effort.id}.json`),
			JSON.stringify(effort, null, 2),
			"utf-8",
		);

		const resultPath = path.join(this.resultsDir, `${effort.id}.json`);
		if (!fs.existsSync(resultPath)) {
			const pending: EffortResult = {
				effortId: effort.id,
				status: "pending",
				results: [],
				submittedAt: effort.submittedAt,
				lastUpdatedAt: new Date().toISOString(),
			};
			fs.writeFileSync(resultPath, JSON.stringify(pending, null, 2), "utf-8");
		}

		return effort.id;
	}

	async query(effortId: string): Promise<EffortResult | null> {
		const file = path.join(this.resultsDir, `${effortId}.json`);
		if (!fs.existsSync(file)) return null;
		return JSON.parse(fs.readFileSync(file, "utf-8")) as EffortResult;
	}

	async list(): Promise<EffortResult[]> {
		const results: EffortResult[] = [];
		for (const filename of fs.readdirSync(this.resultsDir)) {
			if (!filename.endsWith(".json")) continue;
			const effortId = filename.replace(/\.json$/, "");
			const parsed = await this.query(effortId);
			if (parsed) results.push(parsed);
		}
		results.sort((a, b) => {
			const aStamp = a.completedAt ?? a.startedAt ?? a.submittedAt ?? "";
			const bStamp = b.completedAt ?? b.startedAt ?? b.submittedAt ?? "";
			return bStamp.localeCompare(aStamp);
		});
		return results;
	}

	async logs(effortId: string): Promise<EffortLogEntry[] | null> {
		const file = path.join(this.logsDir, `${effortId}.ndjson`);
		if (!fs.existsSync(file)) return null;

		const entries: EffortLogEntry[] = [];
		for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				entries.push(JSON.parse(trimmed) as EffortLogEntry);
			} catch {
				// ignore malformed lines
			}
		}
		return entries;
	}

	private writeControlRequest(
		effortId: string,
		action: "retry" | "cancel",
	): boolean {
		const effortPath = path.join(this.tasksDir, `${effortId}.json`);
		if (!fs.existsSync(effortPath)) return false;

		const payload = {
			effortId,
			action,
			requestedAt: new Date().toISOString(),
		};
		fs.writeFileSync(
			path.join(this.controlDir, `${effortId}.${action}.json`),
			JSON.stringify(payload, null, 2),
			"utf-8",
		);
		return true;
	}

	async retry(effortId: string): Promise<boolean> {
		return this.writeControlRequest(effortId, "retry");
	}

	async cancel(effortId: string): Promise<boolean> {
		return this.writeControlRequest(effortId, "cancel");
	}

	async summary(): Promise<EffortSummary> {
		const summary = baseSummary();
		const efforts = await this.list();
		summary.total = efforts.length;
		for (const effort of efforts) {
			switch (effort.status) {
				case "pending":
					summary.pending += 1;
					break;
				case "in-progress":
					summary.inProgress += 1;
					break;
				case "done":
					summary.done += 1;
					break;
				case "partial":
					summary.partial += 1;
					break;
				case "failed":
					summary.failed += 1;
					break;
				case "timed-out":
					summary.timedOut += 1;
					break;
				case "cancelled":
					summary.cancelled += 1;
					break;
			}
		}
		return summary;
	}
}

class HttpTransportClient implements TaskOperationsAdapter {
	constructor(private readonly baseUrl: string) {}

	async submit(effort: Effort): Promise<string> {
		const response = await fetch(`${this.baseUrl}/efforts`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(effort),
		});

		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const payload = (await response.json()) as { effortId: string };
		return payload.effortId;
	}

	async query(effortId: string): Promise<EffortResult | null> {
		const response = await fetch(`${this.baseUrl}/efforts/${effortId}`);
		if (response.status === 404) return null;
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return (await response.json()) as EffortResult;
	}

	async list(): Promise<EffortResult[]> {
		const response = await fetch(`${this.baseUrl}/efforts`);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return (await response.json()) as EffortResult[];
	}

	async logs(effortId: string): Promise<EffortLogEntry[] | null> {
		const response = await fetch(`${this.baseUrl}/efforts/${effortId}/logs`);
		if (response.status === 404) return null;
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return (await response.json()) as EffortLogEntry[];
	}

	private async command(
		effortId: string,
		action: "retry" | "cancel",
	): Promise<boolean> {
		const response = await fetch(
			`${this.baseUrl}/efforts/${effortId}/${action}`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
			},
		);
		if (response.status === 409 || response.status === 404) return false;
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return true;
	}

	async retry(effortId: string): Promise<boolean> {
		return this.command(effortId, "retry");
	}

	async cancel(effortId: string): Promise<boolean> {
		return this.command(effortId, "cancel");
	}

	async summary(): Promise<EffortSummary> {
		const response = await fetch(`${this.baseUrl}/efforts/summary`);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return (await response.json()) as EffortSummary;
	}
}

export function resolveAdapter(transport: string): TaskOperationsAdapter {
	const resolvedTransport = parseTaskTransport(transport);
	if (resolvedTransport === "http") {
		return new HttpTransportClient(resolveSidecarUrl());
	}

	return new FileTransportClient(path.join(os.homedir(), ".refarm"));
}

function deriveAttemptCount(result: EffortResult): number {
	if (typeof result.attemptCount === "number") {
		return result.attemptCount;
	}
	return result.results.reduce(
		(acc, taskResult) => acc + Number(taskResult.attempts ?? 0),
		0,
	);
}

function safeSessionRecord(fn: () => void): void {
	try {
		fn();
	} catch {
		// session persistence must never break task operations
	}
}

function isPiAgentRespondTask(plugin: string, fn: string): boolean {
	return isPiAgentPluginId(plugin) && fn === "respond";
}

function resolveTaskAdapter(
	transport: TaskTransport,
	adapterResolver: (transport: string) => TaskOperationsAdapter,
): { transport: TaskTransport; adapter: TaskOperationsAdapter } {
	return {
		transport,
		adapter: adapterResolver(transport),
	};
}

export function normalizeTaskArgs(
	plugin: string,
	fn: string,
	args: unknown,
): unknown {
	if (!isPiAgentRespondTask(plugin, fn)) return args;
	if (!args || typeof args !== "object" || Array.isArray(args)) return args;

	const record = args as Record<string, unknown>;
	if (typeof record.prompt === "string" && record.prompt.trim().length > 0) {
		return args;
	}
	if (typeof record.query !== "string" || record.query.trim().length === 0) {
		return args;
	}

	return {
		...record,
		prompt: record.query,
	};
}

export function createTaskCommand(
	adapterResolver: (
		transport: string,
	) => TaskOperationsAdapter = resolveAdapter,
	sessionRecorder: TaskSessionRecorder = createTaskSessionRecorder(),
): Command {
	const taskCommand = new Command("task").description(
		"Manage Refarm runtime task efforts",
	);

	taskCommand.addHelpText(
		"after",
		`

Examples:
  $ refarm task run @refarm.dev/pi-agent respond --args '{"prompt":"hello"}'
  $ refarm task run @refarm.dev/pi-agent respond --transport http
  $ refarm task status <effort-id>
  $ refarm task logs <effort-id>
  $ refarm task resume

Notes:
  file transport queues work under ~/.refarm/tasks for the runtime to pick up.
  http transport submits directly to the local runtime sidecar.
  For http transport readiness, run ${RUNTIME_STATUS_COMMAND}, then ${RUNTIME_ENSURE_WAIT_NEXT_COMMAND}.
  Use ${RUNTIME_DOCTOR_NEXT_ACTION_COMMAND} for the shortest recovery step.
  Use ${RUNTIME_DOCTOR_COMMAND} for the full readiness report.
`,
	);

	taskCommand
		.command("run <plugin> <fn>")
		.description("Dispatch a task effort to the Refarm runtime")
		.option("--args <json>", "Task args as JSON string", "{}")
		.option(
			"--direction <text>",
			"Effort direction (the why)",
			"Manual CLI dispatch",
		)
		.option(
			"--transport <type>",
			"Transport adapter: file or http",
			parseTaskTransport,
			"file",
		)
		.option("--json", "Print machine-readable dispatch result")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm task run @refarm.dev/pi-agent respond --args '{"prompt":"hello"}'
  $ refarm task run @refarm.dev/pi-agent respond --args '{"query":"hello"}'
  $ refarm task run @refarm.dev/pi-agent respond --transport http
  $ refarm task run my-plugin process --direction "Review local change"

Notes:
  --args must be a JSON object or value accepted by the target plugin function.
  file transport queues work under ~/.refarm/tasks for the runtime to pick up.
  http transport submits directly to the local Refarm runtime sidecar.
  For http transport readiness, run ${RUNTIME_STATUS_COMMAND}, then ${RUNTIME_ENSURE_WAIT_NEXT_COMMAND}.
`,
		)
		.action(
			async (
				plugin: string,
				fn: string,
				opts: { args: string; direction: string; transport: TaskTransport; json?: boolean },
			) => {
				let parsedArgs: unknown;
				try {
					parsedArgs = JSON.parse(opts.args);
				} catch {
					if (opts.json) {
						const nextCommand = buildTaskRunCommand(plugin, fn, {
							transport: opts.transport,
							json: true,
						});
						printJson(
							buildJsonErrorEnvelope({
								command: "task",
								operation: "run",
								error: "invalid-task-args-json",
								message: "--args must be valid JSON.",
								nextAction: nextCommand,
								nextCommand,
								nextCommands: [nextCommand],
								extra: {
									plugin,
									fn,
									transport: opts.transport,
								},
							}),
						);
						process.exitCode = 1;
						return;
					}
					console.error(chalk.red("--args must be valid JSON"));
					process.exitCode = 1;
					return;
				}
				parsedArgs = normalizeTaskArgs(plugin, fn, parsedArgs);
				const { transport, adapter } = resolveTaskAdapter(
					opts.transport,
					adapterResolver,
				);

				const effort: Effort = {
					id: crypto.randomUUID(),
					direction: opts.direction,
					tasks: [
						{
							id: crypto.randomUUID(),
							pluginId: plugin,
							fn,
							args: parsedArgs,
						},
					],
					source: "refarm-cli",
					submittedAt: new Date().toISOString(),
				};

				const effortId = await adapter.submit(effort);
				const statusCommand = buildTaskStatusCommand(effortId, transport);
				safeSessionRecord(() => {
					sessionRecorder.rememberRun({
						effort,
						transport,
					});
				});
				if (opts.json) {
					const watchCommand = buildTaskStatusCommand(effortId, transport, {
						json: true,
						watch: true,
					});
					const statusJsonCommand = buildTaskStatusCommand(effortId, transport, {
						json: true,
					});
					const logsCommand = buildTaskLogsCommand(effortId, transport, {
						json: true,
					});
					printTaskJsonSuccess(
						"run",
						{
							effortId,
							transport,
							plugin,
							fn,
							direction: effort.direction,
							effort,
						},
						[watchCommand, statusJsonCommand, logsCommand],
					);
					return;
				}
				console.log(chalk.green(`Effort dispatched: ${chalk.bold(effortId)}`));
				console.log(chalk.gray(`  Use: ${statusCommand}`));
			},
		);

	taskCommand
		.command("status <effortId>")
		.description("Query the result of a dispatched effort")
		.option(
			"--transport <type>",
			"Transport adapter: file or http",
			parseTaskTransport,
			"file",
		)
		.option("--watch", "Poll every 2s until final state")
		.option("--json", "Print machine-readable status JSON")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm task status <effort-id>
  $ refarm task status <effort-id> --watch
  $ refarm task status <effort-id> --transport http --json

Notes:
  Use the same transport used by task run. file transport reads local result
  files; http transport queries the running Refarm runtime sidecar.
`,
		)
		.action(
			async (
				effortId: string,
				opts: { transport: TaskTransport; watch?: boolean; json?: boolean },
			) => {
				const { transport, adapter } = resolveTaskAdapter(
					opts.transport,
					adapterResolver,
				);

				const printStatus = async (): Promise<boolean> => {
					let result: EffortResult | null;
					try {
						result = await adapter.query(effortId);
					} catch (err) {
						reportTaskReadError("status", effortId, transport, err, {
							json: opts.json,
						});
						return true;
					}
					safeSessionRecord(() => {
						sessionRecorder.rememberStatus({
							effortId,
							transport,
							result,
						});
					});
					if (!result) {
						if (opts.json) {
							const statusCommand = buildTaskStatusCommand(effortId, transport, {
								json: true,
								watch: true,
							});
							printTaskJsonSuccess(
								"status",
								{ effortId, transport, status: "not-found" },
								[
									statusCommand,
									buildTaskLogsCommand(effortId, transport, { json: true }),
								],
							);
						} else {
							console.log(chalk.gray("No result yet."));
						}
						return false;
					}

					const attempts = deriveAttemptCount(result);
					const ageSeconds = formatAgeSeconds(result.submittedAt);
					const observedStatus = effortObservedStatus(result);
					const observedErrors = result.results
						.map((taskResult) => taskResultObservedError(taskResult.result))
						.filter((error): error is string => Boolean(error));
					if (opts.json) {
						const nextCommands = isFinalEffortStatus(observedStatus)
							? [
									buildTaskLogsCommand(effortId, transport, { json: true }),
									RESUME_JSON_COMMAND,
								]
							: [
									buildTaskStatusCommand(effortId, transport, {
										json: true,
										watch: true,
									}),
									buildTaskLogsCommand(effortId, transport, { json: true }),
								];
						printTaskJsonSuccess(
							"status",
							{
								effortId,
								transport,
								status: result.status,
								observedStatus,
								...(observedErrors.length > 0
									? { observedErrors }
									: {}),
								attempts,
								ageSeconds,
								result,
							},
							nextCommands,
						);
					} else {
						const color =
							observedStatus === "done"
								? chalk.green
								: observedStatus === "failed" || observedStatus === "cancelled"
									? chalk.red
									: chalk.yellow;
						console.log(
							chalk.bold(`Effort ${effortId}: ${color(observedStatus)}`),
						);
						if (observedStatus !== result.status) {
							console.log(chalk.gray(`  stored_status=${result.status}`));
						}
						console.log(
							chalk.gray(
								`  attempts=${attempts} age=${ageSeconds} transport=${transport}`,
							),
						);
						for (const taskResult of result.results) {
							const taskObservedStatus = taskResultObservedStatus(taskResult);
							const observedError = taskResultObservedError(taskResult.result);
							const statusLabel =
								taskObservedStatus === "ok"
									? chalk.green("ok")
									: taskObservedStatus === "cancelled"
										? chalk.yellow("cancelled")
										: chalk.red("error");
							const attemptsLabel =
								typeof taskResult.attempts === "number"
									? ` (attempts=${taskResult.attempts})`
									: "";
							console.log(
								`  Task ${taskResult.taskId}: ${statusLabel}${attemptsLabel}${taskResult.error || observedError ? ` — ${taskResult.error ?? observedError}` : ""}`,
							);
						}
					}
					return isFinalEffortStatus(observedStatus);
				};

				if (!opts.watch) {
					await printStatus();
					return;
				}

				for (;;) {
					const finished = await printStatus();
					if (finished) break;
					await new Promise((resolve) => setTimeout(resolve, 2000));
				}
			},
		);

	taskCommand
		.command("resume")
		.description("Show local task session checkpoint with resume hints")
		.option("--json", "Print machine-readable JSON output")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm task resume
  $ refarm task resume --json

Notes:
  Resume reads the local CLI checkpoint and prints status/log commands for
  recent task efforts. It does not contact the runtime by itself.
`,
		)
		.action(async (opts: { json?: boolean }) => {
			const checkpoint = sessionRecorder.getCheckpoint();
			if (!checkpoint) {
				if (opts.json) {
					printTaskJsonSuccess(
						"resume",
						{ status: "empty" },
						["refarm task list --json"],
					);
					return;
				}
				console.log(chalk.gray("No task session checkpoint yet."));
				return;
			}

			if (opts.json) {
				const active = checkpoint.activeEffortId
					? checkpoint.efforts.find(
							(entry) => entry.effortId === checkpoint.activeEffortId,
						)
					: undefined;
				const fallback = checkpoint.efforts[0];
				const effortCommands = taskSessionEffortCommands(checkpoint.efforts, {
					json: true,
				});
				const nextCommands = active
					? [
							buildTaskStatusCommand(active.effortId, active.transport, {
								json: true,
								watch: true,
							}),
							buildTaskLogsCommand(active.effortId, active.transport, {
								json: true,
							}),
						]
					: fallback
						? [
								buildTaskStatusCommand(fallback.effortId, fallback.transport, {
									json: true,
								}),
								buildTaskLogsCommand(fallback.effortId, fallback.transport, {
									json: true,
								}),
							]
						: ["refarm task list --json"];
				printTaskJsonSuccess(
					"resume",
					{
						status: "ok",
						checkpoint: taskCheckpointJsonHandoff(checkpoint),
						effortCommands,
						modelInspectCommand: MODEL_CURRENT_JSON_COMMAND,
					},
					nextCommands,
				);
				return;
			}

			console.log(
				chalk.bold(
					`Task session updated ${checkpoint.updatedAt} (entries=${checkpoint.efforts.length})`,
				),
			);
			if (checkpoint.activeEffortId) {
				const active = checkpoint.efforts.find(
					(entry) => entry.effortId === checkpoint.activeEffortId,
				);
				if (active) {
					console.log(
						chalk.yellow(
							`Active effort: ${active.effortId} (${active.transport})`,
						),
					);
					console.log(chalk.gray(`  Resume watch: ${active.statusCommand} --watch`));
				}
			}

			for (const effort of checkpoint.efforts.slice(0, 10)) {
				const status = effort.lastStatus ?? "unknown";
				const lastTouch = effort.lastStatusAt ?? effort.lastLogAt ?? "-";
				console.log(
					`  ${effort.effortId}  status=${status} transport=${effort.transport} touched=${lastTouch}`,
				);
				const modelRoute = formatTaskSessionModelRoute(effort.lastModelRoute);
				if (modelRoute) console.log(chalk.gray(`    model:  ${modelRoute}`));
				console.log(chalk.gray(`    status: ${effort.statusCommand}`));
				console.log(chalk.gray(`    logs:   ${effort.logsCommand}`));
			}
		});

	taskCommand
		.command("list")
		.description("List known efforts and queue summary")
		.option(
			"--transport <type>",
			"Transport adapter: file or http",
			parseTaskTransport,
			"file",
		)
		.option("--json", "Print machine-readable JSON output")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm task list
  $ refarm task list --json
  $ refarm task list --transport http --json
  $ refarm task resume --json

Notes:
  file transport reads local queue/result files under ~/.refarm.
  http transport queries the running Refarm runtime sidecar.
  JSON output includes status/log nextCommands for the newest effort when one exists.
  Use resume to continue from the local checkpoint after a previous run/status/logs command.
`,
		)
		.action(async (opts: { transport: TaskTransport; json?: boolean }) => {
			const { transport, adapter } = resolveTaskAdapter(
				opts.transport,
				adapterResolver,
			);
			const [summary, efforts] = await Promise.all([
				adapter.summary(),
				adapter.list(),
			]);
			safeSessionRecord(() => {
				sessionRecorder.rememberList({
					transport,
					efforts,
				});
			});

			if (opts.json) {
				const effortCommands = buildTaskEffortCommands(efforts, transport, {
					json: true,
				});
				const nextCommands = efforts[0]
					? [
							buildTaskStatusCommand(efforts[0].effortId, transport, {
								json: true,
							}),
							buildTaskLogsCommand(efforts[0].effortId, transport, {
								json: true,
							}),
						]
					: [];
				printTaskJsonSuccess(
					"list",
					{
						transport,
						summary,
						efforts,
						effortCommands,
						modelInspectCommand: MODEL_CURRENT_JSON_COMMAND,
					},
					nextCommands,
				);
				return;
			}

			console.log(
				chalk.bold(
					`Efforts: total=${summary.total} pending=${summary.pending} in-progress=${summary.inProgress} done=${summary.done} partial=${summary.partial} failed=${summary.failed} timed-out=${summary.timedOut} cancelled=${summary.cancelled}`,
				),
			);
			if (efforts.length === 0) {
				console.log(chalk.gray("No efforts found."));
				return;
			}

			for (const effort of efforts) {
				const attempts = deriveAttemptCount(effort);
				const ageSeconds = formatAgeSeconds(effort.submittedAt);
				console.log(
					`  ${effort.effortId}  status=${effort.status} tasks=${effort.results.length} attempts=${attempts} age=${ageSeconds}`,
				);
			}
		});

	taskCommand
		.command("logs <effortId>")
		.description("Show execution logs for an effort")
		.option(
			"--transport <type>",
			"Transport adapter: file or http",
			parseTaskTransport,
			"file",
		)
		.option(
			"--tail <n>",
			"Only show the last N log entries",
			(value) => parsePositiveIntOption(value, "--tail"),
			40,
		)
		.option("--json", "Print machine-readable JSON output")
		.action(
			async (
				effortId: string,
				opts: { transport: TaskTransport; tail: number; json?: boolean },
			) => {
				const { transport, adapter } = resolveTaskAdapter(
					opts.transport,
					adapterResolver,
				);
				let logs: EffortLogEntry[] | null;
				try {
					logs = await adapter.logs(effortId);
				} catch (err) {
					reportTaskReadError("logs", effortId, transport, err, {
						json: opts.json,
					});
					return;
				}
				safeSessionRecord(() => {
					sessionRecorder.rememberLogs({
						effortId,
						transport,
						logs: logs ?? [],
					});
				});
				if (!logs || logs.length === 0) {
					if (opts.json) {
						printTaskJsonSuccess(
							"logs",
							{ effortId, transport, logs: [] },
							[buildTaskStatusCommand(effortId, transport, { json: true })],
						);
						return;
					}
					console.log(chalk.gray("No logs yet."));
					return;
				}

				const sliced = logs.slice(-opts.tail);
				if (opts.json) {
					printTaskJsonSuccess(
						"logs",
						{ effortId, transport, logs: sliced },
						[buildTaskStatusCommand(effortId, transport, { json: true })],
					);
					return;
				}

				for (const entry of sliced) {
					const taskPart = entry.taskId ? ` task=${entry.taskId}` : "";
					const attemptPart =
						typeof entry.attempt === "number"
							? ` attempt=${entry.attempt}`
							: "";
					const metaPart = formatLogMeta(entry.meta);
					console.log(
						`${entry.timestamp} [${entry.level}] ${entry.event}${taskPart}${attemptPart}${metaPart} — ${entry.message}`,
					);
				}
			},
		);

	taskCommand
		.command("retry <effortId>")
		.description("Retry a finished effort (respects adapter policy)")
		.option(
			"--transport <type>",
			"Transport adapter: file or http",
			parseTaskTransport,
			"file",
		)
		.option("--json", "Print machine-readable retry result")
		.action(async (effortId: string, opts: { transport: TaskTransport; json?: boolean }) => {
			const { transport, adapter } = resolveTaskAdapter(
				opts.transport,
				adapterResolver,
			);
			const statusCommand = buildTaskStatusCommand(effortId, transport);
			let accepted: boolean;
			try {
				accepted = await adapter.retry(effortId);
			} catch (err) {
				reportTaskControlError("retry", effortId, transport, err, {
					json: opts.json,
				});
				return;
			}
			if (!accepted) {
				if (opts.json) {
					printJson(
						buildJsonErrorEnvelope({
							command: "task",
							operation: "retry",
							error: "task-retry-rejected",
							message: `Retry rejected for effort ${effortId}.`,
							nextAction: statusCommand,
							nextActions: [statusCommand],
							nextCommand: statusCommand,
							nextCommands: [statusCommand, RUNTIME_DOCTOR_NEXT_COMMAND],
							extra: {
								effortId,
								transport,
								action: "retry",
								accepted: false,
							},
						}),
					);
				} else {
					console.error(chalk.red(`Retry rejected for effort ${effortId}`));
				}
				process.exitCode = 1;
				return;
			}
			safeSessionRecord(() => {
				sessionRecorder.rememberControl({
					effortId,
					transport,
					action: "retry",
				});
			});
			if (opts.json) {
				const watchCommand = buildTaskStatusCommand(effortId, transport, {
					json: true,
					watch: true,
				});
				const logsCommand = buildTaskLogsCommand(effortId, transport, {
					json: true,
				});
				printJson(
					buildJsonSuccessEnvelope({
						command: "task",
						operation: "retry",
						nextAction: watchCommand,
						nextActions: [watchCommand, logsCommand],
						nextCommand: watchCommand,
						nextCommands: [watchCommand, logsCommand],
						extra: {
							effortId,
							transport,
							action: "retry",
							accepted: true,
						},
					}),
				);
				return;
			}
			console.log(chalk.green(`Retry requested for effort ${effortId}`));
		});

	taskCommand
		.command("cancel <effortId>")
		.description("Request cancellation for a pending or running effort")
		.option(
			"--transport <type>",
			"Transport adapter: file or http",
			parseTaskTransport,
			"file",
		)
		.option("--json", "Print machine-readable cancel result")
		.action(async (effortId: string, opts: { transport: TaskTransport; json?: boolean }) => {
			const { transport, adapter } = resolveTaskAdapter(
				opts.transport,
				adapterResolver,
			);
			const statusCommand = buildTaskStatusCommand(effortId, transport);
			let accepted: boolean;
			try {
				accepted = await adapter.cancel(effortId);
			} catch (err) {
				reportTaskControlError("cancel", effortId, transport, err, {
					json: opts.json,
				});
				return;
			}
			if (!accepted) {
				if (opts.json) {
					printJson(
						buildJsonErrorEnvelope({
							command: "task",
							operation: "cancel",
							error: "task-cancel-rejected",
							message: `Cancel rejected for effort ${effortId}.`,
							nextAction: statusCommand,
							nextActions: [statusCommand],
							nextCommand: statusCommand,
							nextCommands: [statusCommand, RUNTIME_DOCTOR_NEXT_COMMAND],
							extra: {
								effortId,
								transport,
								action: "cancel",
								accepted: false,
							},
						}),
					);
				} else {
					console.error(chalk.red(`Cancel rejected for effort ${effortId}`));
				}
				process.exitCode = 1;
				return;
			}
			safeSessionRecord(() => {
				sessionRecorder.rememberControl({
					effortId,
					transport,
					action: "cancel",
				});
			});
			if (opts.json) {
				const statusJsonCommand = buildTaskStatusCommand(effortId, transport, {
					json: true,
				});
				printJson(
					buildJsonSuccessEnvelope({
						command: "task",
						operation: "cancel",
						nextAction: statusJsonCommand,
						nextActions: [statusJsonCommand],
						nextCommand: statusJsonCommand,
						nextCommands: [statusJsonCommand],
						extra: {
							effortId,
							transport,
							action: "cancel",
							accepted: true,
						},
					}),
				);
				return;
			}
			console.log(chalk.yellow(`Cancel requested for effort ${effortId}`));
		});

	return taskCommand;
}

export const taskCommand = createTaskCommand();
