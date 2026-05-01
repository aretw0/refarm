import fs from "node:fs";
import path from "node:path";
import type {
	Effort,
	EffortResult,
	EffortTransportAdapter,
	Task,
	TaskResult,
} from "@refarm.dev/effort-contract-v1";

export type TaskExecutorFn = (
	task: Task,
	effortId: string,
) => Promise<{ status: "ok" | "error"; result?: unknown; error?: string }>;

export class FileTransportAdapter implements EffortTransportAdapter {
	private readonly tasksDir: string;
	private readonly resultsDir: string;
	private readonly inFlightEfforts = new Set<string>();

	constructor(
		baseDir: string,
		private readonly executor: TaskExecutorFn,
	) {
		this.tasksDir = path.join(baseDir, "tasks");
		this.resultsDir = path.join(baseDir, "task-results");
		fs.mkdirSync(this.tasksDir, { recursive: true });
		fs.mkdirSync(this.resultsDir, { recursive: true });
	}

	async submit(effort: Effort): Promise<string> {
		const filePath = path.join(this.tasksDir, `${effort.id}.json`);
		fs.writeFileSync(filePath, JSON.stringify(effort, null, 2), "utf-8");
		return effort.id;
	}

	async query(effortId: string): Promise<EffortResult | null> {
		const filePath = path.join(this.resultsDir, `${effortId}.json`);
		if (!fs.existsSync(filePath)) return null;
		return JSON.parse(fs.readFileSync(filePath, "utf-8")) as EffortResult;
	}

	async process(effort: Effort): Promise<void> {
		if (this.inFlightEfforts.has(effort.id)) return;
		this.inFlightEfforts.add(effort.id);

		try {
			const results: TaskResult[] = [];

			for (const task of effort.tasks) {
				try {
					const output = await this.executor(task, effort.id);
					results.push({
						taskId: task.id,
						effortId: effort.id,
						status: output.status,
						result: output.result,
						error: output.error,
						completedAt: new Date().toISOString(),
					});
				} catch (error: unknown) {
					results.push({
						taskId: task.id,
						effortId: effort.id,
						status: "error",
						error: error instanceof Error ? error.message : String(error),
						completedAt: new Date().toISOString(),
					});
				}
			}

			const allOk = results.every((result) => result.status === "ok");
			const effortResult: EffortResult = {
				effortId: effort.id,
				status: allOk ? "done" : "failed",
				results,
				completedAt: new Date().toISOString(),
			};

			const resultPath = path.join(this.resultsDir, `${effort.id}.json`);
			fs.writeFileSync(
				resultPath,
				JSON.stringify(effortResult, null, 2),
				"utf-8",
			);
		} finally {
			this.inFlightEfforts.delete(effort.id);
		}
	}

	watch(): () => void {
		const processFile = async (filename: string): Promise<void> => {
			if (!filename.endsWith(".json")) return;
			const filePath = path.join(this.tasksDir, filename);
			if (!fs.existsSync(filePath)) return;

			let effort: Effort;
			try {
				effort = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Effort;
			} catch {
				return;
			}

			if (!effort?.id || !Array.isArray(effort.tasks)) return;
			if (fs.existsSync(path.join(this.resultsDir, `${effort.id}.json`)))
				return;
			await this.process(effort);
		};

		for (const filename of fs.readdirSync(this.tasksDir)) {
			void processFile(filename);
		}

		const watcher = fs.watch(this.tasksDir, (event, filename) => {
			if (!filename || (event !== "rename" && event !== "change")) return;
			void processFile(filename.toString());
		});

		return () => watcher.close();
	}
}
