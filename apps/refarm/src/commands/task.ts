import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
	Effort,
	EffortLogEntry,
	EffortResult,
	EffortSummary,
	EffortTransportAdapter,
} from "@refarm.dev/effort-contract-v1";
import chalk from "chalk";
import { Command } from "commander";

interface TaskOperationsAdapter extends EffortTransportAdapter {
	list(): Promise<EffortResult[]>;
	logs(effortId: string): Promise<EffortLogEntry[] | null>;
	retry(effortId: string): Promise<boolean>;
	cancel(effortId: string): Promise<boolean>;
	summary(): Promise<EffortSummary>;
}

const FINAL_STATUSES = new Set(["done", "failed", "cancelled"]);

function baseSummary(): EffortSummary {
	return {
		total: 0,
		pending: 0,
		inProgress: 0,
		done: 0,
		failed: 0,
		cancelled: 0,
	};
}

function formatAgeSeconds(submittedAt?: string): string {
	if (!submittedAt) return "-";
	const submittedMs = Date.parse(submittedAt);
	if (Number.isNaN(submittedMs)) return "-";
	return `${Math.max(0, Math.floor((Date.now() - submittedMs) / 1000))}s`;
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
				case "failed":
					summary.failed += 1;
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
	if (transport === "http") {
		return new HttpTransportClient("http://127.0.0.1:42001");
	}

	if (transport !== "file") {
		throw new Error(`Unsupported transport: ${transport}`);
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

export function createTaskCommand(
	adapterResolver: (
		transport: string,
	) => TaskOperationsAdapter = resolveAdapter,
): Command {
	const taskCommand = new Command("task").description(
		"Manage Farmhand task efforts",
	);

	taskCommand
		.command("run <plugin> <fn>")
		.description("Dispatch a task effort to Farmhand")
		.option("--args <json>", "Task args as JSON string", "{}")
		.option(
			"--direction <text>",
			"Effort direction (the why)",
			"Manual CLI dispatch",
		)
		.option("--transport <type>", "Transport adapter: file or http", "file")
		.action(
			async (
				plugin: string,
				fn: string,
				opts: { args: string; direction: string; transport: string },
			) => {
				const adapter = adapterResolver(opts.transport);
				let parsedArgs: unknown;
				try {
					parsedArgs = JSON.parse(opts.args);
				} catch {
					console.error(chalk.red("--args must be valid JSON"));
					process.exitCode = 1;
					return;
				}

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
				console.log(chalk.green(`Effort dispatched: ${chalk.bold(effortId)}`));
				console.log(
					chalk.gray(
						`  Use: refarm task status ${effortId} --transport ${opts.transport}`,
					),
				);
			},
		);

	taskCommand
		.command("status <effortId>")
		.description("Query the result of a dispatched effort")
		.option("--transport <type>", "Transport adapter: file or http", "file")
		.option("--watch", "Poll every 2s until final state")
		.option("--json", "Print machine-readable status JSON")
		.action(
			async (
				effortId: string,
				opts: { transport: string; watch?: boolean; json?: boolean },
			) => {
				const adapter = adapterResolver(opts.transport);

				const printStatus = async (): Promise<boolean> => {
					const result = await adapter.query(effortId);
					if (!result) {
						if (opts.json) {
							console.log(
								JSON.stringify({ effortId, status: "not-found" }, null, 2),
							);
						} else {
							console.log(chalk.gray("No result yet."));
						}
						return false;
					}

					const attempts = deriveAttemptCount(result);
					const ageSeconds = formatAgeSeconds(result.submittedAt);
					if (opts.json) {
						console.log(
							JSON.stringify(
								{
									effortId,
									status: result.status,
									attempts,
									ageSeconds,
									result,
								},
								null,
								2,
							),
						);
					} else {
						const color =
							result.status === "done"
								? chalk.green
								: result.status === "failed" || result.status === "cancelled"
									? chalk.red
									: chalk.yellow;
						console.log(
							chalk.bold(`Effort ${effortId}: ${color(result.status)}`),
						);
						console.log(
							chalk.gray(
								`  attempts=${attempts} age=${ageSeconds} transport=${opts.transport}`,
							),
						);
						for (const taskResult of result.results) {
							const statusLabel =
								taskResult.status === "ok"
									? chalk.green("ok")
									: taskResult.status === "cancelled"
										? chalk.yellow("cancelled")
										: chalk.red("error");
							const attemptsLabel =
								typeof taskResult.attempts === "number"
									? ` (attempts=${taskResult.attempts})`
									: "";
							console.log(
								`  Task ${taskResult.taskId}: ${statusLabel}${attemptsLabel}${taskResult.error ? ` — ${taskResult.error}` : ""}`,
							);
						}
					}
					return FINAL_STATUSES.has(result.status);
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
		.command("list")
		.description("List known efforts and queue summary")
		.option("--transport <type>", "Transport adapter: file or http", "file")
		.option("--json", "Print machine-readable JSON output")
		.action(async (opts: { transport: string; json?: boolean }) => {
			const adapter = adapterResolver(opts.transport);
			const [summary, efforts] = await Promise.all([
				adapter.summary(),
				adapter.list(),
			]);

			if (opts.json) {
				console.log(JSON.stringify({ summary, efforts }, null, 2));
				return;
			}

			console.log(
				chalk.bold(
					`Efforts: total=${summary.total} pending=${summary.pending} in-progress=${summary.inProgress} done=${summary.done} failed=${summary.failed} cancelled=${summary.cancelled}`,
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
		.option("--transport <type>", "Transport adapter: file or http", "file")
		.option("--tail <n>", "Only show the last N log entries", "40")
		.option("--json", "Print machine-readable JSON output")
		.action(
			async (
				effortId: string,
				opts: { transport: string; tail: string; json?: boolean },
			) => {
				const adapter = adapterResolver(opts.transport);
				const logs = await adapter.logs(effortId);
				if (!logs || logs.length === 0) {
					console.log(chalk.gray("No logs yet."));
					return;
				}

				const tailCount = Number.parseInt(opts.tail, 10);
				const sliced =
					Number.isFinite(tailCount) && tailCount > 0
						? logs.slice(-tailCount)
						: logs;
				if (opts.json) {
					console.log(JSON.stringify({ effortId, logs: sliced }, null, 2));
					return;
				}

				for (const entry of sliced) {
					const taskPart = entry.taskId ? ` task=${entry.taskId}` : "";
					const attemptPart =
						typeof entry.attempt === "number"
							? ` attempt=${entry.attempt}`
							: "";
					console.log(
						`${entry.timestamp} [${entry.level}] ${entry.event}${taskPart}${attemptPart} — ${entry.message}`,
					);
				}
			},
		);

	taskCommand
		.command("retry <effortId>")
		.description("Retry a finished effort (respects adapter policy)")
		.option("--transport <type>", "Transport adapter: file or http", "file")
		.action(async (effortId: string, opts: { transport: string }) => {
			const adapter = adapterResolver(opts.transport);
			const accepted = await adapter.retry(effortId);
			if (!accepted) {
				console.error(chalk.red(`Retry rejected for effort ${effortId}`));
				process.exitCode = 1;
				return;
			}
			console.log(chalk.green(`Retry requested for effort ${effortId}`));
		});

	taskCommand
		.command("cancel <effortId>")
		.description("Request cancellation for a pending or running effort")
		.option("--transport <type>", "Transport adapter: file or http", "file")
		.action(async (effortId: string, opts: { transport: string }) => {
			const adapter = adapterResolver(opts.transport);
			const accepted = await adapter.cancel(effortId);
			if (!accepted) {
				console.error(chalk.red(`Cancel rejected for effort ${effortId}`));
				process.exitCode = 1;
				return;
			}
			console.log(chalk.yellow(`Cancel requested for effort ${effortId}`));
		});

	return taskCommand;
}

export const taskCommand = createTaskCommand();
