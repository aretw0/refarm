import type {
	Effort,
	EffortResult,
	EffortStatus,
	Task,
	TaskResult,
} from "@refarm.dev/effort-contract-v1";
import { EffortExecutionState } from "./effort-execution-state.js";
import type { EffortRepository } from "./effort-repository.js";

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

export interface EffortProcessorOptions {
	onEffortStart?: (effortId: string, pluginIds: string[]) => void;
	onEffortEnd?: (effortId: string) => void;
}

const DEFAULT_MAX_ATTEMPTS = 2;
const TERMINAL_STATUSES = new Set<EffortStatus>(["done", "failed", "cancelled"]);

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

export function isTerminalEffortStatus(status: EffortStatus): boolean {
	return TERMINAL_STATUSES.has(status);
}

/** Executes effort lifecycle policy independently from ingress and persistence technology. */
export class EffortProcessor {
	constructor(
		private readonly repository: EffortRepository,
		private readonly executionState: EffortExecutionState,
		private readonly executor: TaskExecutorFn,
		private readonly options: EffortProcessorOptions = {},
	) {}

	async process(effort: Effort, options: { force: boolean } = { force: false }): Promise<void> {
		if (this.executionState.isInFlight(effort.id)) return;

		const current = this.repository.readResult(effort.id);
		if (current && !options.force && isTerminalEffortStatus(current.status)) return;

		const startTime = nowIso();
		const maxAttempts = parseEffortMaxAttempts(effort);
		const baseResults = options.force || !current ? [] : [...(current.results ?? [])];
		const resultByTaskId = new Map(baseResults.map((result) => [result.taskId, result]));
		const finalResults: TaskResult[] = [];
		let attemptCount = options.force ? 0 : Number(current?.attemptCount ?? 0);
		let cancelled = this.executionState.isCancellationRequested(effort.id);

		this.executionState.begin(effort.id);
		this.options.onEffortStart?.(
			effort.id,
			effort.tasks.map((task) => task.pluginId),
		);
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

				if (this.executionState.isCancellationRequested(effort.id)) {
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
					if (this.executionState.isCancellationRequested(effort.id)) {
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
			this.executionState.finish(effort.id);
			this.options.onEffortEnd?.(effort.id);
			if (isTerminalEffortStatus(this.repository.readResult(effort.id)?.status ?? "pending")) {
				this.executionState.clearCancellation(effort.id);
			}
		}
	}
}
