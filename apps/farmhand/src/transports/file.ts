import type {
	Effort,
	EffortLogEntry,
	EffortResult,
	EffortStatus,
	EffortSummary,
	Task,
	TaskResult,
} from "@refarm.dev/effort-contract-v1";
import type { PressureSnapshot, PressureWindow } from "@refarm.dev/pressure-contract-v1";
import fs from "node:fs";
import path from "node:path";
import type { EffortOperations } from "../effort-operations.js";
import { FileEffortRepository } from "./file-effort-repository.js";

export type TaskExecutorFn = (
	task: Task,
	effortId: string,
	effort: Effort,
) => Promise<{
	status: "ok" | "error";
	result?: unknown;
	error?: string;
	meta?: Record<string, unknown>;
}>;

export interface FileTransportOptions {
	onEffortStart?: (effortId: string, pluginIds: string[]) => void;
	onEffortEnd?: (effortId: string) => void;
}

const DEFAULT_MAX_ATTEMPTS = 2;
const TERMINAL_STATUSES = new Set<EffortStatus>(["done", "failed", "cancelled"]);

// The telemetry endpoint's wire shapes ARE the pressure:v1 contract's — this producer emits the
// exact PressureSnapshot / PressureWindow the operator's pressure client consumes (single source,
// no more local redeclaration that could drift on the EffortSummary fields). Aliased to the local
// names so the rest of this transport is untouched.
export type RuntimeTelemetrySnapshot = PressureSnapshot;
export type RuntimeTelemetryWindow = PressureWindow;

function nowIso(): string {
	return new Date().toISOString();
}

function parseEffortMaxAttempts(effort: Effort): number {
	const context = effort.context;
	if (!context || typeof context !== "object") return DEFAULT_MAX_ATTEMPTS;

	const contextObject = context as Record<string, unknown>;
	const direct = Number(contextObject.maxAttempts);
	if (Number.isFinite(direct) && direct > 0) return Math.floor(direct);

	const retry = contextObject.retry;
	if (!retry || typeof retry !== "object") return DEFAULT_MAX_ATTEMPTS;

	const retryMax = Number((retry as Record<string, unknown>).maxAttempts);
	if (Number.isFinite(retryMax) && retryMax > 0) return Math.floor(retryMax);
	return DEFAULT_MAX_ATTEMPTS;
}

export class FileTransportAdapter implements EffortOperations {
	private readonly repository: FileEffortRepository;

	private readonly inFlightEfforts = new Set<string>();
	private readonly cancelRequests = new Set<string>();
	private readonly queue: string[] = [];
	private readonly queueOptions = new Map<string, { force: boolean }>();
	private drainingQueue = false;

	constructor(
		baseDir: string,
		private readonly executor: TaskExecutorFn,
		private readonly options: FileTransportOptions = {},
	) {
		this.repository = new FileEffortRepository(baseDir);
	}

	async submit(effort: Effort): Promise<string> {
		this.repository.writeEffort(effort);

		const existing = this.repository.readResult(effort.id);
		if (!existing) {
			const pendingResult: EffortResult = {
				effortId: effort.id,
				status: "pending",
				results: [],
				submittedAt: effort.submittedAt,
				lastUpdatedAt: nowIso(),
			};
			this.repository.writeResult(pendingResult);
		}

		this.repository.appendLog(effort.id, {
			effortId: effort.id,
			timestamp: nowIso(),
			level: "info",
			event: "submitted",
			message: `Effort submitted with ${effort.tasks.length} task(s)`,
			meta: {
				direction: effort.direction,
				source: effort.source,
			},
		});

		return effort.id;
	}

	async query(effortId: string): Promise<EffortResult | null> {
		return this.repository.readResult(effortId);
	}

	async list(): Promise<EffortResult[]> {
		return this.repository.listResults();
	}

	async logs(effortId: string): Promise<EffortLogEntry[] | null> {
		return this.repository.readLogs(effortId);
	}

	async retry(effortId: string): Promise<boolean> {
		if (!this.repository.hasEffort(effortId)) return false;

		const current = this.repository.readResult(effortId);
		if (!current) return false;
		if (current.status === "in-progress") return false;
		if (current.status === "pending") return true;

		this.cancelRequests.delete(effortId);
		this.repository.appendLog(effortId, {
			effortId,
			timestamp: nowIso(),
			level: "info",
			event: "retry_requested",
			message: "Retry requested",
		});

		this.enqueue(effortId, { force: true });
		return true;
	}

	async cancel(effortId: string): Promise<boolean> {
		if (!this.repository.hasEffort(effortId)) return false;

		const current = this.repository.readResult(effortId);
		if (current && TERMINAL_STATUSES.has(current.status)) return false;

		this.cancelRequests.add(effortId);
		this.repository.appendLog(effortId, {
			effortId,
			timestamp: nowIso(),
			level: "warn",
			event: "cancel_requested",
			message: "Cancellation requested",
		});

		if (!this.inFlightEfforts.has(effortId)) {
			const cancelled: EffortResult = {
				effortId,
				status: "cancelled",
				results: current?.results ?? [],
				submittedAt: current?.submittedAt,
				startedAt: current?.startedAt,
				attemptCount: current?.attemptCount,
				lastUpdatedAt: nowIso(),
				completedAt: nowIso(),
			};
			this.repository.writeResult(cancelled);
		}

		return true;
	}

	async summary(): Promise<EffortSummary> {
		const results = await this.list();
		const summary: EffortSummary = {
			total: results.length,
			pending: 0,
			inProgress: 0,
			done: 0,
			delivered: 0,
			partial: 0,
			failed: 0,
			timedOut: 0,
			cancelled: 0,
		};

		for (const result of results) {
			switch (result.status) {
				case "pending":
					summary.pending += 1;
					break;
				case "in-progress":
					summary.inProgress += 1;
					break;
				case "done":
					summary.done += 1;
					break;
				case "delivered":
					summary.delivered += 1;
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

	async telemetry(): Promise<RuntimeTelemetrySnapshot> {
		const summary = await this.summary();
		return {
			...summary,
			queueDepth: this.queue.length,
			inFlight: this.inFlightEfforts.size,
			cancelRequests: this.cancelRequests.size,
			generatedAt: nowIso(),
		};
	}

	async telemetryWindow(minutes: number): Promise<RuntimeTelemetryWindow> {
		const windowMinutes = Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 60;
		const cutoffMs = Date.now() - windowMinutes * 60_000;
		const windowSummary: EffortSummary = {
			total: 0,
			pending: 0,
			inProgress: 0,
			done: 0,
			delivered: 0,
			partial: 0,
			failed: 0,
			timedOut: 0,
			cancelled: 0,
		};

		const results = await this.list();
		for (const result of results) {
			const stamp = result.completedAt ?? result.startedAt ?? result.submittedAt;
			const stampMs = stamp ? Date.parse(stamp) : Number.NaN;
			if (!Number.isFinite(stampMs) || stampMs < cutoffMs) continue;

			windowSummary.total += 1;
			switch (result.status) {
				case "pending":
					windowSummary.pending += 1;
					break;
				case "in-progress":
					windowSummary.inProgress += 1;
					break;
				case "done":
					windowSummary.done += 1;
					break;
				case "delivered":
					windowSummary.delivered += 1;
					break;
				case "partial":
					windowSummary.partial += 1;
					break;
				case "failed":
					windowSummary.failed += 1;
					break;
				case "timed-out":
					windowSummary.timedOut += 1;
					break;
				case "cancelled":
					windowSummary.cancelled += 1;
					break;
			}
		}

		const terminal =
			windowSummary.done +
			windowSummary.delivered +
			windowSummary.partial +
			windowSummary.failed +
			windowSummary.timedOut +
			windowSummary.cancelled;
		const failureRatePct =
			terminal > 0 ? Number(((windowSummary.failed / terminal) * 100).toFixed(2)) : null;

		return {
			...windowSummary,
			windowMinutes,
			since: new Date(cutoffMs).toISOString(),
			terminal,
			failureRatePct,
			generatedAt: nowIso(),
		};
	}

	async process(effort: Effort): Promise<void> {
		await this.processEffort(effort, { force: false });
	}

	watch(): () => void {
		const processTaskFile = (filename: string): void => {
			if (!filename.endsWith(".json")) return;
			const effortId = filename.replace(/\.json$/, "");
			if (!effortId) return;
			this.enqueue(effortId);
		};

		const processControlFile = (filename: string): void => {
			if (!filename.endsWith(".json")) return;
			const filePath = path.join(this.repository.controlDir, filename);
			if (!fs.existsSync(filePath)) return;

			const retryMatch = filename.match(/^(.+)\.retry\.json$/);
			const cancelMatch = filename.match(/^(.+)\.cancel\.json$/);
			try {
				if (retryMatch) {
					void this.retry(retryMatch[1]!);
					return;
				}
				if (cancelMatch) {
					void this.cancel(cancelMatch[1]!);
					return;
				}
			} finally {
				try {
					fs.unlinkSync(filePath);
				} catch {
					// best effort
				}
			}
		};

		for (const filename of fs.readdirSync(this.repository.tasksDir)) {
			processTaskFile(filename);
		}

		for (const filename of fs.readdirSync(this.repository.resultsDir)) {
			if (!filename.endsWith(".json")) continue;
			const effortId = filename.replace(/\.json$/, "");
			const result = this.repository.readResult(effortId);
			if (!result) continue;
			if (result.status === "pending" || result.status === "in-progress") {
				this.enqueue(effortId);
			}
		}

		for (const filename of fs.readdirSync(this.repository.controlDir)) {
			processControlFile(filename);
		}

		const tasksWatcher = fs.watch(this.repository.tasksDir, (event, filename) => {
			if (!filename || (event !== "rename" && event !== "change")) return;
			processTaskFile(filename.toString());
		});

		const controlWatcher = fs.watch(this.repository.controlDir, (event, filename) => {
			if (!filename || (event !== "rename" && event !== "change")) return;
			processControlFile(filename.toString());
		});

		return () => {
			tasksWatcher.close();
			controlWatcher.close();
		};
	}

	private enqueue(effortId: string, options: { force?: boolean } = {}): void {
		const force = options.force ?? false;
		const existing = this.queueOptions.get(effortId);
		if (existing) {
			if (force && !existing.force) {
				this.queueOptions.set(effortId, { force: true });
			}
			return;
		}

		this.queueOptions.set(effortId, { force });
		this.queue.push(effortId);
		void this.drainQueue();
	}

	private async drainQueue(): Promise<void> {
		if (this.drainingQueue) return;
		this.drainingQueue = true;
		try {
			while (this.queue.length > 0) {
				const effortId = this.queue.shift();
				if (!effortId) continue;

				const options = this.queueOptions.get(effortId) ?? { force: false };
				this.queueOptions.delete(effortId);

				const effort = this.repository.readEffort(effortId);
				if (!effort) continue;

				await this.processEffort(effort, { force: options.force });
			}
		} finally {
			this.drainingQueue = false;
		}
	}

	private async processEffort(effort: Effort, options: { force: boolean }): Promise<void> {
		if (this.inFlightEfforts.has(effort.id)) return;

		const current = this.repository.readResult(effort.id);
		if (current && !options.force && TERMINAL_STATUSES.has(current.status)) {
			return;
		}

		const startTime = nowIso();
		const maxAttempts = parseEffortMaxAttempts(effort);
		const baseResults = options.force || !current ? [] : [...(current.results ?? [])];
		const resultByTaskId = new Map(baseResults.map((result) => [result.taskId, result]));
		const finalResults: TaskResult[] = [];
		let attemptCount = options.force ? 0 : Number(current?.attemptCount ?? 0);
		let cancelled = this.cancelRequests.has(effort.id);

		this.inFlightEfforts.add(effort.id);
		const pluginIds = effort.tasks.map((t) => t.pluginId);
		this.options.onEffortStart?.(effort.id, pluginIds);
		this.repository.writeResult({
			effortId: effort.id,
			status: cancelled ? "cancelled" : "in-progress",
			results: options.force ? [] : baseResults,
			submittedAt: current?.submittedAt ?? effort.submittedAt,
			startedAt: current?.startedAt ?? startTime,
			attemptCount,
			lastUpdatedAt: startTime,
			completedAt: cancelled ? startTime : undefined,
		});

		this.repository.appendLog(effort.id, {
			effortId: effort.id,
			timestamp: startTime,
			level: "info",
			event: "processing_started",
			message: `Processing started (maxAttempts=${maxAttempts}, force=${options.force})`,
		});

		try {
			for (const task of effort.tasks) {
				const existingTaskResult = resultByTaskId.get(task.id);
				if (existingTaskResult && !options.force) {
					finalResults.push(existingTaskResult);
					continue;
				}

				if (this.cancelRequests.has(effort.id)) {
					cancelled = true;
					finalResults.push({
						taskId: task.id,
						effortId: effort.id,
						status: "cancelled",
						error: "Cancelled before execution",
						attempts: 0,
						startedAt: nowIso(),
						completedAt: nowIso(),
					});
					continue;
				}

				const taskStart = nowIso();
				let successResult: TaskResult | null = null;
				let failureResult: TaskResult | null = null;

				for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
					attemptCount += 1;
					this.repository.appendLog(effort.id, {
						effortId: effort.id,
						timestamp: nowIso(),
						level: "info",
						event: "task_attempt_started",
						message: `Attempt ${attempt}/${maxAttempts}`,
						taskId: task.id,
						attempt,
					});

					try {
						const output = await this.executor(task, effort.id, effort);
						if (output.status === "ok") {
							successResult = {
								taskId: task.id,
								effortId: effort.id,
								status: "ok",
								result: output.result,
								attempts: attempt,
								startedAt: taskStart,
								completedAt: nowIso(),
							};
							this.repository.appendLog(effort.id, {
								effortId: effort.id,
								timestamp: nowIso(),
								level: "info",
								event: "task_attempt_succeeded",
								message: `Task succeeded on attempt ${attempt}`,
								taskId: task.id,
								attempt,
								...(output.meta ? { meta: output.meta } : {}),
							});
							break;
						}

						const outputError = output.error ?? "Task returned error status";
						failureResult = {
							taskId: task.id,
							effortId: effort.id,
							status: "error",
							error: outputError,
							attempts: attempt,
							startedAt: taskStart,
							completedAt: nowIso(),
						};
						this.repository.appendLog(effort.id, {
							effortId: effort.id,
							timestamp: nowIso(),
							level: "warn",
							event: "task_attempt_failed",
							message: outputError,
							taskId: task.id,
							attempt,
							...(output.meta ? { meta: output.meta } : {}),
						});
					} catch (error: unknown) {
						const message = error instanceof Error ? error.message : String(error);
						failureResult = {
							taskId: task.id,
							effortId: effort.id,
							status: "error",
							error: message,
							attempts: attempt,
							startedAt: taskStart,
							completedAt: nowIso(),
						};
						this.repository.appendLog(effort.id, {
							effortId: effort.id,
							timestamp: nowIso(),
							level: "error",
							event: "task_attempt_failed",
							message,
							taskId: task.id,
							attempt,
						});
					}

					if (successResult) break;
					if (this.cancelRequests.has(effort.id)) {
						cancelled = true;
						break;
					}
				}

				if (successResult) {
					finalResults.push(successResult);
					continue;
				}

				if (cancelled) {
					finalResults.push({
						taskId: task.id,
						effortId: effort.id,
						status: "cancelled",
						error: "Cancelled while retrying task",
						attempts: failureResult?.attempts ?? 0,
						startedAt: taskStart,
						completedAt: nowIso(),
					});
					continue;
				}

				finalResults.push(
					failureResult ?? {
						taskId: task.id,
						effortId: effort.id,
						status: "error",
						error: "Task failed with no explicit error",
						attempts: maxAttempts,
						startedAt: taskStart,
						completedAt: nowIso(),
					},
				);
			}

			if (cancelled) {
				for (const task of effort.tasks) {
					if (finalResults.find((result) => result.taskId === task.id)) continue;
					finalResults.push({
						taskId: task.id,
						effortId: effort.id,
						status: "cancelled",
						error: "Cancelled before execution",
						attempts: 0,
						startedAt: nowIso(),
						completedAt: nowIso(),
					});
				}
			}

			const allOk = finalResults.every((result) => result.status === "ok");
			const status = cancelled ? "cancelled" : allOk ? "done" : "failed";
			const completedAt = nowIso();

			const finalResult: EffortResult = {
				effortId: effort.id,
				status,
				results: finalResults,
				submittedAt: current?.submittedAt ?? effort.submittedAt,
				startedAt: current?.startedAt ?? startTime,
				attemptCount,
				lastUpdatedAt: completedAt,
				completedAt,
			};
			this.repository.writeResult(finalResult);
			this.repository.appendLog(effort.id, {
				effortId: effort.id,
				timestamp: completedAt,
				level: status === "done" ? "info" : status === "failed" ? "error" : "warn",
				event: "processing_finished",
				message: `Processing finished with status=${status}`,
				meta: {
					attemptCount,
					taskCount: finalResults.length,
				},
			});
		} finally {
			this.inFlightEfforts.delete(effort.id);
			this.options.onEffortEnd?.(effort.id);
			if (TERMINAL_STATUSES.has(this.repository.readResult(effort.id)?.status ?? "pending")) {
				this.cancelRequests.delete(effort.id);
			}
		}
	}

}
