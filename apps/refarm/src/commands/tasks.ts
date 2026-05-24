import type { Task, TaskEvent } from "@refarm.dev/task-contract-v1";
import chalk from "chalk";
import { Command, InvalidArgumentError } from "commander";
import { buildJsonErrorEnvelope, printJson } from "./json-output.js";
import {
	RUNTIME_DOCTOR_COMMAND,
	RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
	RUNTIME_DOCTOR_NEXT_COMMAND,
	RUNTIME_START_WAIT_COMMAND,
	RUNTIME_STATUS_COMMAND,
} from "./runtime-recovery.js";
import { reportSidecarError } from "./sidecar-error.js";
import { sidecarUrl } from "./sidecar-url.js";

interface TaskListJson {
	schemaVersion: 1;
	command: "tasks";
	operation: "list";
	filters: {
		status?: string;
		session_id?: string;
		limit?: number;
	};
	tasks: Task[];
}

interface TaskShowJson {
	schemaVersion: 1;
	command: "tasks";
	operation: "show";
	prefix: string;
	task: Task;
	events: TaskEvent[];
}

function parsePositiveIntOption(value: string, label: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new InvalidArgumentError(`${label} must be a positive integer.`);
	}
	return parsed;
}

function printTaskErrorJson(input: {
	error: string;
	message?: string;
	prefix?: string;
	matches?: string[];
	nextAction: string;
	nextActions?: string[];
	nextCommand?: string | null;
	nextCommands?: string[];
}): void {
	printJson(
		buildJsonErrorEnvelope({
			command: "tasks",
			operation: "show",
			error: input.error,
			message: input.message,
			nextAction: input.nextAction,
			nextActions: input.nextActions,
			nextCommand: input.nextCommand,
			nextCommands: input.nextCommands,
			extra: {
				schemaVersion: 1,
				...(input.prefix ? { prefix: input.prefix } : {}),
				...(input.matches ? { matches: input.matches } : {}),
			},
		}),
	);
	process.exitCode = 1;
}

function formatTaskId(id: string): string {
	const parts = id.split(":");
	return parts.at(-1)?.slice(-12) ?? id;
}

function formatAge(ns: number | undefined): string {
	if (!ns) return "";
	const ageMs = Date.now() - ns / 1_000_000;
	const mins = Math.floor(ageMs / 60_000);
	const hours = Math.floor(mins / 60);
	const days = Math.floor(hours / 24);
	if (days > 0) return `${days}d ago`;
	if (hours > 0) return `${hours}h ago`;
	if (mins > 0) return `${mins}m ago`;
	return "just now";
}

function statusIcon(status: string | undefined): string {
	switch (status) {
		case "done":
			return chalk.green("●");
		case "active":
			return chalk.yellow("▶");
		case "failed":
			return chalk.red("✗");
		case "blocked":
			return chalk.dim("⊘");
		default:
			return chalk.dim("·");
	}
}

function statusLabel(status: string | undefined): string {
	const pad = (s: string) => s.padEnd(7);
	switch (status) {
		case "done":
			return chalk.green(pad("done"));
		case "active":
			return chalk.yellow(pad("active"));
		case "failed":
			return chalk.red(pad("failed"));
		case "blocked":
			return chalk.dim(pad("blocked"));
		default:
			return chalk.dim(pad(status ?? "?"));
	}
}

async function fetchTasks(
	params: { status?: string; session_id?: string; limit?: number } = {},
): Promise<Task[]> {
	const query = new URLSearchParams();
	if (params.status) query.set("status", params.status);
	if (params.session_id) query.set("session_id", params.session_id);
	if (params.limit) query.set("limit", String(params.limit));
	const qs = query.toString() ? `?${query}` : "";
	const response = await fetch(sidecarUrl(`/tasks${qs}`));
	if (!response.ok) throw new Error(`sidecar HTTP ${response.status}`);
	const body = (await response.json()) as { tasks: Task[] };
	return body.tasks ?? [];
}

async function listTasks(opts: {
	status?: string;
	session?: string;
	limit?: number;
	json?: boolean;
}): Promise<void> {
	let tasks: Task[];
	try {
		tasks = await fetchTasks({
			status: opts.status,
			session_id: opts.session,
			limit: opts.limit,
		});
	} catch (err) {
		reportSidecarError(err, {
			json: opts.json,
			command: "tasks",
			operation: "list",
		});
		return;
	}

	if (opts.json) {
		const body: TaskListJson = {
			schemaVersion: 1,
			command: "tasks",
			operation: "list",
			filters: {
				status: opts.status,
				session_id: opts.session,
				limit: opts.limit,
			},
			tasks,
		};
		printJson(body);
		return;
	}

	if (tasks.length === 0) {
		console.log(chalk.dim("No tasks yet. Tasks are created automatically on each refarm ask."));
		return;
	}

	console.log(chalk.bold(`\n  Tasks  (${tasks.length} shown)\n`));

	for (const task of tasks) {
		const short = formatTaskId(task["@id"]);
		const age = formatAge(task.created_at_ns);
		const title = task.title
			? chalk.white(task.title.slice(0, 60) + (task.title.length > 60 ? "…" : ""))
			: chalk.dim("untitled");

		console.log(
			`  ${statusIcon(task.status)} ${statusLabel(task.status)} ${chalk.cyan(short)}  ${title}  ${chalk.dim(age)}`,
		);
	}

	console.log(
		chalk.dim(
			"\n  refarm tasks show <id-prefix>   task details and events" +
			"\n  refarm tasks --status active    filter by status\n",
		),
	);
}

async function showTask(prefix: string, opts: { json?: boolean } = {}): Promise<void> {
	let body: { task: Task; events: TaskEvent[] };
	try {
		const response = await fetch(
			sidecarUrl(`/tasks/${encodeURIComponent(prefix)}`),
		);
		const parsed = (await response.json()) as typeof body & {
			error?: string;
			matches?: string[];
		};
		if (response.status === 404) {
			if (opts.json) {
				printTaskErrorJson({
					error: "task-not-found",
					prefix,
					nextAction: "refarm tasks --json",
					nextCommand: "refarm tasks --json",
				});
				return;
			}
			console.error(chalk.red(`✗  No task matching "${prefix}"`));
			process.exitCode = 1;
			return;
		}
		if (response.status === 409) {
			if (opts.json) {
				printTaskErrorJson({
					error: "ambiguous-task-prefix",
					message: parsed.error,
					prefix,
					matches: parsed.matches ?? [],
					nextAction: "refarm tasks --json",
					nextCommand: "refarm tasks --json",
				});
				return;
			}
			console.error(
				chalk.red(`✗  Ambiguous prefix "${prefix}" — ${parsed.error}`),
			);
			for (const m of parsed.matches ?? []) console.error(chalk.dim(`   ${m}`));
			process.exitCode = 1;
			return;
		}
		if (!response.ok) {
			if (opts.json) {
				printTaskErrorJson({
					error: "task-show-failed",
					message: parsed.error ?? `HTTP ${response.status}`,
					prefix,
					nextAction: RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
					nextActions: [RUNTIME_DOCTOR_NEXT_ACTION_COMMAND],
					nextCommand: RUNTIME_DOCTOR_NEXT_COMMAND,
					nextCommands: [RUNTIME_DOCTOR_NEXT_COMMAND],
				});
				return;
			}
			console.error(chalk.red(`✗  ${parsed.error ?? `HTTP ${response.status}`}`));
			process.exitCode = 1;
			return;
		}
		body = parsed;
	} catch (err) {
		reportSidecarError(err, {
			json: opts.json,
			command: "tasks",
			operation: "show",
		});
		return;
	}

	const { task, events } = body;

	if (opts.json) {
		const output: TaskShowJson = {
			schemaVersion: 1,
			command: "tasks",
			operation: "show",
			prefix,
			task,
			events,
		};
		printJson(output);
		return;
	}

	const short = formatTaskId(task["@id"]);

	console.log(chalk.bold(`\n  Task ${chalk.cyan(short)}`));
	console.log(`  ${statusIcon(task.status)} ${statusLabel(task.status)}  ${chalk.white(task.title ?? "untitled")}`);
	if (task.created_at_ns) {
		console.log(chalk.dim(`  Created ${formatAge(task.created_at_ns)}`));
	}
	if (task.context_id) {
		console.log(chalk.dim(`  Session ${task.context_id}`));
	}

	if (events.length > 0) {
		console.log(chalk.dim("\n  Events:"));
		for (const ev of events) {
			const ts = formatAge(ev.timestamp_ns);
			const payload = ev.payload ?? {};
			let detail = "";
			if (ev.event === "status_changed" && typeof payload.status === "string") {
				const model = typeof payload.model === "string" ? `  ${payload.model}` : "";
				const tin = typeof payload.tokens_in === "number" ? `  ↓${payload.tokens_in}` : "";
				const tout = typeof payload.tokens_out === "number" ? `↑${payload.tokens_out}` : "";
				detail = chalk.dim(`${payload.status}${model}${tin} ${tout}`);
			}
			console.log(
				`  ${chalk.dim(ev.event.padEnd(16))}  ${chalk.dim(ts)}  ${detail}`,
			);
		}
	}

	console.log(chalk.dim(`\n  ${task["@id"]}\n`));
}

export function createTasksCommand(): Command {
	return new Command("tasks")
		.description("List and inspect agent task memory")
		.option("-s, --status <status>", "Filter by status (done/active/failed/blocked)")
		.option("--session <id>", "Filter by session ID")
		.option(
			"-n, --limit <n>",
			"Max tasks to show",
			(value) => parsePositiveIntOption(value, "--limit"),
			20,
		)
		.option("--json", "Output machine-readable JSON")
		.addHelpText(
			"after",
			[
				"",
				"Examples:",
				"  $ refarm tasks",
				"  $ refarm tasks --status active",
				"  $ refarm tasks --session <session-id>",
				"  $ refarm tasks show <task-id-prefix>",
				"  $ refarm tasks show <task-id-prefix> --json",
				"  $ refarm tasks --json",
				"",
				"Notes:",
				"  Tasks are created by runtime-backed flows such as refarm ask and refarm task run.",
				`  If the task sidecar is unavailable, run ${RUNTIME_STATUS_COMMAND}, then ${RUNTIME_START_WAIT_COMMAND}.`,
				`  Use ${RUNTIME_DOCTOR_NEXT_ACTION_COMMAND} for the shortest recovery step.`,
				`  Use ${RUNTIME_DOCTOR_COMMAND} for the full readiness report.`,
				"  Use refarm task for dispatch/retry/cancel operations.",
			].join("\n"),
		)
		.addCommand(
			new Command("show")
				.description("Show details and events for a task")
				.argument("<id>", "Task ID or unique prefix")
				.option("--json", "Output machine-readable JSON")
				.action(async (prefix: string, opts: { json?: boolean }) => {
					await showTask(prefix, { json: opts.json });
				}),
		)
		.action(
			async (opts: {
				status?: string;
				session?: string;
				limit?: number;
				json?: boolean;
			}) => {
				await listTasks({
					status: opts.status,
					session: opts.session,
					limit: opts.limit,
					json: opts.json,
				});
			});
}

export const tasksCommand = createTasksCommand();
