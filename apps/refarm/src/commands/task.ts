import { normalizePluginId } from "@refarm.dev/config";
import type {
	Effort,
	EffortLogEntry,
	EffortResult,
	EffortSummary,
} from "@refarm.dev/effort-contract-v1";
import chalk from "chalk";
import { Command } from "commander";
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
import {
	observedEffortStatus,
	observedTaskResultError,
	observedTaskResultStatus,
} from "./task-observation.js";
import {
	buildTaskEffortCommands,
	buildTaskLogsCommand,
	buildTaskStatusCommand,
	createTaskSessionRecorder,
	formatTaskSessionModelRoute,
	taskSessionEffortCommands,
	type TaskSessionRecorder,
} from "./task-session.js";
import { isFinalEffortStatus } from "./task-status.js";
import {
	buildTaskRunCommand,
	deriveAttemptCount,
	effortSummariesEqual,
	formatAgeSeconds,
	formatEffortSummary,
	formatLogMeta,
	isResumableTaskSessionEffort,
	isRuntimeAgentRespondTask,
	observedEffortFields,
	observedEffortList,
	observedEffortSummary,
	parsePositiveIntOption,
	parseTaskTransport,
	printTaskJsonSuccess,
	reportTaskControlError,
	reportTaskListError,
	reportTaskReadError,
	resolveAdapter,
	resolveTaskAdapter,
	safeSessionRecord,
	taskCheckpointJsonHandoff,
	type TaskOperationsAdapter,
	type TaskTransport,
} from "./task-support.js";

export { resolveAdapter } from "./task-support.js";

export function normalizeTaskArgs(
	plugin: string,
	fn: string,
	args: unknown,
): unknown {
	if (!isRuntimeAgentRespondTask(plugin, fn)) return args;
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
  $ refarm task run runtime-agent respond --args '{"prompt":"hello"}'
  $ refarm task run runtime-agent respond --transport http
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
  $ refarm task run runtime-agent respond --args '{"prompt":"hello"}'
  $ refarm task run runtime-agent respond --args '{"query":"hello"}'
  $ refarm task run runtime-agent respond --transport http
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
				const pluginId = normalizePluginId(plugin);
				parsedArgs = normalizeTaskArgs(pluginId, fn, parsedArgs);
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
							pluginId,
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
					const observed = observedEffortFields(result);
					const { observedStatus } = observed;
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
								...observed,
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
							const taskObservedStatus = observedTaskResultStatus(taskResult);
							const observedError = observedTaskResultError(taskResult.result);
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
				const resumable = active && isResumableTaskSessionEffort(active)
					? active
					: checkpoint.efforts.find(isResumableTaskSessionEffort);
				const effortCommands = taskSessionEffortCommands(checkpoint.efforts, {
					json: true,
				});
				const nextCommands = resumable
					? [
							buildTaskStatusCommand(resumable.effortId, resumable.transport, {
								json: true,
								watch: true,
							}),
							buildTaskLogsCommand(resumable.effortId, resumable.transport, {
								json: true,
							}),
						]
					: [];
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
  JSON output also includes observedSummary/observedEfforts when stored results hide agent-level errors.
  Human output prints an Observed summary when it differs from the stored summary.
  Use resume to continue from the local checkpoint after a previous run/status/logs command.
`,
		)
		.action(async (opts: { transport: TaskTransport; json?: boolean }) => {
			const { transport, adapter } = resolveTaskAdapter(
				opts.transport,
				adapterResolver,
			);
			let summary: EffortSummary;
			let efforts: EffortResult[];
			try {
				[summary, efforts] = await Promise.all([
					adapter.summary(),
					adapter.list(),
				]);
			} catch (err) {
				reportTaskListError(transport, err, { json: opts.json });
				return;
			}
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
				const observedEfforts = observedEffortList(efforts);
				const observedSummary = observedEffortSummary(efforts);
				const resumable = efforts.find(
					(effort) => !isFinalEffortStatus(observedEffortStatus(effort)),
				);
				const nextCommands = resumable
					? [
							buildTaskStatusCommand(resumable.effortId, transport, {
								json: true,
							}),
							buildTaskLogsCommand(resumable.effortId, transport, {
								json: true,
							}),
						]
					: [];
				printTaskJsonSuccess(
					"list",
					{
						transport,
						summary,
						observedSummary,
						efforts,
						observedEfforts,
						effortCommands,
						modelInspectCommand: MODEL_CURRENT_JSON_COMMAND,
					},
					nextCommands,
				);
				return;
			}

			const observedSummary = observedEffortSummary(efforts);
			console.log(chalk.bold(`Efforts: ${formatEffortSummary(summary)}`));
			if (!effortSummariesEqual(summary, observedSummary)) {
				console.log(
					chalk.yellow(`Observed: ${formatEffortSummary(observedSummary)}`),
				);
			}
			if (efforts.length === 0) {
				console.log(chalk.gray("No efforts found."));
				return;
			}

			for (const effort of efforts) {
				const attempts = deriveAttemptCount(effort);
				const ageSeconds = formatAgeSeconds(effort.submittedAt);
				const observedStatus = observedEffortStatus(effort);
				const storedStatus =
					observedStatus === effort.status ? "" : ` stored_status=${effort.status}`;
				console.log(
					`  ${effort.effortId}  status=${observedStatus}${storedStatus} tasks=${effort.results.length} attempts=${attempts} age=${ageSeconds}`,
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
				let observed: ReturnType<typeof observedEffortFields> | undefined;
				try {
					const result = await adapter.query(effortId);
					if (result) observed = observedEffortFields(result);
				} catch {
					observed = undefined;
				}
				if (!logs || logs.length === 0) {
					if (opts.json) {
						printTaskJsonSuccess(
							"logs",
							{ effortId, transport, ...(observed ?? {}), logs: [] },
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
						{ effortId, transport, ...(observed ?? {}), logs: sliced },
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
			const statusCommand = buildTaskStatusCommand(effortId, transport, {
				json: opts.json,
			});
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
			const statusCommand = buildTaskStatusCommand(effortId, transport, {
				json: opts.json,
			});
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
