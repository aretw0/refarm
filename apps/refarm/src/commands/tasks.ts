import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "@refarm.dev/capabilities/envelope";
import { quoteCommandArg } from "@refarm.dev/cli/command-handoff";
import { fetchSidecarWithTimeout, readCompleteness } from "@refarm.dev/sidecar-client";
import type { Task, TaskEvent } from "@refarm.dev/task-contract-v1";
import chalk from "chalk";
import { Command, InvalidArgumentError } from "commander";
import { refarmCommand } from "../brand.js";
import {
	RUNTIME_DOCTOR_COMMAND,
	RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
	RUNTIME_DOCTOR_NEXT_COMMAND,
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
	RUNTIME_STATUS_COMMAND,
} from "./runtime-recovery.js";
import { reportSidecarError } from "./sidecar-error.js";
import { sidecarUrl } from "./sidecar-url.js";

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

function tasksListJsonCommand(): string {
	return refarmCommand(["tasks", "--json"]);
}

function tasksShowJsonCommand(prefix: string): string {
	return refarmCommand(["tasks", "show", quoteCommandArg(prefix), "--json"]);
}

/**
 * A page of tasks, and whether it was the whole answer.
 *
 * `GET /tasks` gained `stored`/`truncated`/`offset` when ISS-041 was fixed, and dropped `total`
 * — which had been computed AFTER the truncate and so always equalled the page size. This
 * command read only `tasks` and would have gone on quietly printing a page as if it were the
 * record. Same three-state discipline as `budget.ts`: absent means absent, never rounded.
 */
interface TaskPage {
	tasks: Task[];
	stored: number | undefined;
	truncated: boolean | undefined;
	offset: number;
}

/** PURE. Split out so the older-sidecar case — a response with no `stored`/`truncated` at all —
 *  is testable with a literal body and no network. */
export function taskPageFromBody(body: {
	tasks?: Task[];
	stored?: number;
	truncated?: boolean;
	offset?: number;
}): TaskPage {
	return {
		tasks: Array.isArray(body.tasks) ? body.tasks : [],
		stored: typeof body.stored === "number" ? body.stored : undefined,
		truncated: typeof body.truncated === "boolean" ? body.truncated : undefined,
		// The caller's own parameter coming back, so 0 is a correct default — unlike the two
		// above, which are measurements the node either made or did not.
		offset: typeof body.offset === "number" ? body.offset : 0,
	};
}

async function fetchTasks(
	params: { status?: string; session_id?: string; limit?: number; offset?: number } = {},
): Promise<TaskPage> {
	const query = new URLSearchParams();
	if (params.status) query.set("status", params.status);
	if (params.session_id) query.set("session_id", params.session_id);
	if (params.limit) query.set("limit", String(params.limit));
	if (params.offset) query.set("offset", String(params.offset));
	const qs = query.toString() ? `?${query}` : "";
	const response = await fetchSidecarWithTimeout(sidecarUrl(`/tasks${qs}`));
	if (!response.ok) throw new Error(`sidecar HTTP ${response.status}`);
	return taskPageFromBody((await response.json()) as Parameters<typeof taskPageFromBody>[0]);
}

async function listTasks(opts: {
	status?: string;
	session?: string;
	limit?: number;
	offset?: number;
	json?: boolean;
}): Promise<void> {
	let page: TaskPage;
	try {
		page = await fetchTasks({
			status: opts.status,
			session_id: opts.session,
			limit: opts.limit,
			offset: opts.offset,
		});
	} catch (err) {
		reportSidecarError(err, {
			json: opts.json,
			command: "tasks",
			operation: "list",
		});
		return;
	}

	const { tasks, stored, truncated, offset } = page;

	if (opts.json) {
		const nextCommands = tasks[0]
			? [tasksShowJsonCommand(tasks[0]["@id"]), tasksListJsonCommand()]
			: [];
		const body = buildJsonSuccessEnvelope({
			command: "tasks",
			operation: "list",
			extra: {
				schemaVersion: 1,
				filters: {
					status: opts.status,
					session_id: opts.session,
					limit: opts.limit,
					offset: opts.offset,
				},
				tasks,
				// Carried verbatim, and `JSON.stringify` drops an `undefined` key entirely, so
				// absent means absent on the wire too. `completeness` is the VERDICT beside them,
				// from the one function the storage contract exports for this — a consumer
				// deciding "that is all the tasks" needs to know which of three states it read.
				stored,
				truncated,
				offset,
				completeness: readCompleteness({ truncated }),
			},
			nextCommands,
		});
		printJson(body);
		return;
	}

	if (tasks.length === 0) {
		// THREE STATES, and only one of them is "there are none". An empty page from a node that
		// did not report completeness proves nothing about the record — saying "No tasks yet"
		// there is the same lie `budget.ts` was fixed for, one command over.
		console.log(
			chalk.dim(
				readCompleteness({ truncated }) === "unknown"
					? "No tasks in this response. This node did not report how many exist, so whether that means there are none cannot be determined from it."
					: "No tasks yet. Tasks are created automatically on each refarm ask.",
			),
		);
		return;
	}

	console.log(chalk.bold(`\n  Tasks  (${tasks.length} shown)\n`));
	if (truncated === true) {
		const storedNote = typeof stored === "number" ? ` of ${stored} stored` : "";
		console.log(
			chalk.yellow(
				`  ⚠  Showing ${tasks.length}${storedNote}, starting at ${offset} — ` +
					`the rest is reachable: \`refarm tasks --offset ${offset + tasks.length}\`.\n`,
			),
		);
	} else if (truncated === undefined) {
		console.log(
			chalk.dim("  ?  Completeness unknown — this node did not report how many tasks exist.\n"),
		);
	}

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
		const response = await fetchSidecarWithTimeout(
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
					nextAction: tasksListJsonCommand(),
					nextCommand: tasksListJsonCommand(),
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
					nextAction: tasksListJsonCommand(),
					nextCommand: tasksListJsonCommand(),
				});
				return;
			}
			console.error(chalk.red(`✗  Ambiguous prefix "${prefix}" — ${parsed.error}`));
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
					nextActions: [RUNTIME_DOCTOR_NEXT_ACTION_COMMAND, RUNTIME_STATUS_COMMAND],
					nextCommand: RUNTIME_DOCTOR_NEXT_COMMAND,
					nextCommands: [RUNTIME_DOCTOR_NEXT_COMMAND, RUNTIME_ENSURE_WAIT_NEXT_COMMAND],
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
		const output = buildJsonSuccessEnvelope({
			command: "tasks",
			operation: "show",
			extra: {
				schemaVersion: 1,
				prefix,
				task,
				events,
			},
			nextCommands: [tasksListJsonCommand()],
		});
		printJson(output);
		return;
	}

	const short = formatTaskId(task["@id"]);

	console.log(chalk.bold(`\n  Task ${chalk.cyan(short)}`));
	console.log(
		`  ${statusIcon(task.status)} ${statusLabel(task.status)}  ${chalk.white(task.title ?? "untitled")}`,
	);
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
			console.log(`  ${chalk.dim(ev.event.padEnd(16))}  ${chalk.dim(ts)}  ${detail}`);
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
		.option(
			"--offset <n>",
			"Skip this many tasks — the way past the single-page cap (ISS-042)",
			(value) => {
				// Zero is valid and is the default, so this cannot reuse the positive-int parser
				// beside it: "start at the beginning" must be expressible.
				const parsed = Number(value);
				if (!Number.isInteger(parsed) || parsed < 0) {
					throw new InvalidArgumentError("--offset must be a non-negative integer.");
				}
				return parsed;
			},
			0,
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
				`  If the task sidecar is unavailable, run ${RUNTIME_STATUS_COMMAND}, then ${RUNTIME_ENSURE_WAIT_NEXT_COMMAND}.`,
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
				.action(async (prefix: string, opts: { json?: boolean }, subcommand: Command) => {
					// `refarm tasks show <id> --json` bound `--json` to the PARENT, not here:
					// Commander consumes an option the parent declares wherever it appears, and
					// `tasks` declares `--json` too. So `opts.json` was undefined and the command
					// printed human text (and, on a refusal, an unparseable stderr line) to a
					// consumer that had asked for JSON. Read it from either place, the way
					// `runtime status` and `agent doctor` already do.
					const json =
						opts.json === true || subcommand.parent?.opts<{ json?: boolean }>().json === true;
					await showTask(prefix, { json });
				}),
		)
		.action(
			async (opts: {
				status?: string;
				session?: string;
				limit?: number;
				offset?: number;
				json?: boolean;
			}) => {
				await listTasks({
					status: opts.status,
					session: opts.session,
					limit: opts.limit,
					offset: opts.offset,
					json: opts.json,
				});
			},
		);
}

export const tasksCommand = createTasksCommand();
