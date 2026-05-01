import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
	Effort,
	EffortResult,
	EffortTransportAdapter,
} from "@refarm.dev/effort-contract-v1";
import chalk from "chalk";
import { Command } from "commander";

class FileTransportClient implements EffortTransportAdapter {
	private readonly tasksDir: string;
	private readonly resultsDir: string;

	constructor(baseDir: string) {
		this.tasksDir = path.join(baseDir, "tasks");
		this.resultsDir = path.join(baseDir, "task-results");
		fs.mkdirSync(this.tasksDir, { recursive: true });
		fs.mkdirSync(this.resultsDir, { recursive: true });
	}

	async submit(effort: Effort): Promise<string> {
		const file = path.join(this.tasksDir, `${effort.id}.json`);
		fs.writeFileSync(file, JSON.stringify(effort, null, 2), "utf-8");
		return effort.id;
	}

	async query(effortId: string): Promise<EffortResult | null> {
		const file = path.join(this.resultsDir, `${effortId}.json`);
		if (!fs.existsSync(file)) return null;
		return JSON.parse(fs.readFileSync(file, "utf-8")) as EffortResult;
	}
}

class HttpTransportClient implements EffortTransportAdapter {
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
}

export function resolveAdapter(transport: string): EffortTransportAdapter {
	if (transport === "http") {
		return new HttpTransportClient("http://127.0.0.1:42001");
	}

	if (transport !== "file") {
		throw new Error(`Unsupported transport: ${transport}`);
	}

	return new FileTransportClient(path.join(os.homedir(), ".refarm"));
}

export function createTaskCommand(
	adapterResolver: (
		transport: string,
	) => EffortTransportAdapter = resolveAdapter,
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
		.option("--watch", "Poll every 2s until done or failed")
		.action(
			async (
				effortId: string,
				opts: { transport: string; watch?: boolean },
			) => {
				const adapter = adapterResolver(opts.transport);

				const printStatus = async (): Promise<boolean> => {
					const result = await adapter.query(effortId);
					if (!result) {
						console.log(chalk.gray("No result yet."));
						return false;
					}

					const color =
						result.status === "done"
							? chalk.green
							: result.status === "failed"
								? chalk.red
								: chalk.yellow;
					console.log(
						chalk.bold(`Effort ${effortId}: ${color(result.status)}`),
					);
					for (const taskResult of result.results) {
						const statusLabel =
							taskResult.status === "ok"
								? chalk.green("ok")
								: chalk.red("error");
						console.log(
							`  Task ${taskResult.taskId}: ${statusLabel}${taskResult.error ? ` — ${taskResult.error}` : ""}`,
						);
					}
					return result.status === "done" || result.status === "failed";
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

	return taskCommand;
}

export const taskCommand = createTaskCommand();
