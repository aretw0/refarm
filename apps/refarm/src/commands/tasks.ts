import chalk from "chalk";
import { Command } from "commander";

const SIDECAR_URL = "http://127.0.0.1:42001";

interface TaskNode {
	"@id": string;
	"@type": string;
	title?: string;
	status?: string;
	context_id?: string | null;
	created_at_ns?: number;
	updated_at_ns?: number;
}

interface TaskEvent {
	"@id": string;
	task_id: string;
	event: string;
	actor?: string;
	timestamp_ns?: number;
	payload?: Record<string, unknown>;
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
): Promise<TaskNode[]> {
	const query = new URLSearchParams();
	if (params.status) query.set("status", params.status);
	if (params.session_id) query.set("session_id", params.session_id);
	if (params.limit) query.set("limit", String(params.limit));
	const qs = query.toString() ? `?${query}` : "";
	const response = await fetch(`${SIDECAR_URL}/tasks${qs}`);
	if (!response.ok) throw new Error(`sidecar HTTP ${response.status}`);
	const body = (await response.json()) as { tasks: TaskNode[] };
	return body.tasks ?? [];
}

async function listTasks(opts: {
	status?: string;
	session?: string;
	limit?: number;
}): Promise<void> {
	let tasks: TaskNode[];
	try {
		tasks = await fetchTasks({
			status: opts.status,
			session_id: opts.session,
			limit: opts.limit,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
			console.error(chalk.red("✗  tractor is not running."));
			console.error(chalk.dim("   Start it:  npm run farmhand:daemon"));
		} else {
			console.error(chalk.red(`✗  ${msg}`));
		}
		process.exit(1);
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

async function showTask(prefix: string): Promise<void> {
	let body: { task: TaskNode; events: TaskEvent[] };
	try {
		const response = await fetch(
			`${SIDECAR_URL}/tasks/${encodeURIComponent(prefix)}`,
		);
		const parsed = (await response.json()) as typeof body & {
			error?: string;
			matches?: string[];
		};
		if (response.status === 404) {
			console.error(chalk.red(`✗  No task matching "${prefix}"`));
			process.exit(1);
		}
		if (response.status === 409) {
			console.error(
				chalk.red(`✗  Ambiguous prefix "${prefix}" — ${parsed.error}`),
			);
			for (const m of parsed.matches ?? []) console.error(chalk.dim(`   ${m}`));
			process.exit(1);
		}
		if (!response.ok) {
			console.error(chalk.red(`✗  ${parsed.error ?? `HTTP ${response.status}`}`));
			process.exit(1);
		}
		body = parsed;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
			console.error(chalk.red("✗  tractor is not running."));
		} else {
			console.error(chalk.red(`✗  ${msg}`));
		}
		process.exit(1);
	}

	const { task, events } = body;
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
		.option("-n, --limit <n>", "Max tasks to show", "20")
		.addCommand(
			new Command("show")
				.description("Show details and events for a task")
				.argument("<id>", "Task ID or unique prefix")
				.action(async (prefix: string) => {
					await showTask(prefix);
				}),
		)
		.action(async (opts: { status?: string; session?: string; limit?: string }) => {
			await listTasks({
				status: opts.status,
				session: opts.session,
				limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
			});
		});
}

export const tasksCommand = createTasksCommand();
