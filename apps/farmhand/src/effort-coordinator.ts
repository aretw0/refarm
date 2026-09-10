import type {
	Effort,
	EffortLogEntry,
	EffortResult,
	EffortSummary,
} from "@refarm.dev/effort-contract-v1";
import type { PressureSnapshot, PressureWindow } from "@refarm.dev/pressure-contract-v1";
import { EffortExecutionState } from "./effort-execution-state.js";
import type { EffortOperations } from "./effort-operations.js";
import {
	EffortProcessor,
	isTerminalEffortStatus,
	type EffortProcessorOptions,
	type TaskExecutorFn,
} from "./effort-processor.js";
import { EffortQueue } from "./effort-queue.js";
import type { EffortRepository } from "./effort-repository.js";
import { summarizeEfforts, summarizeEffortWindow } from "./effort-summary.js";

export type EffortCoordinatorOptions = EffortProcessorOptions;
export type RuntimeTelemetrySnapshot = PressureSnapshot;
export type RuntimeTelemetryWindow = PressureWindow;

function nowIso(): string {
	return new Date().toISOString();
}

/**
 * Transport-neutral application coordinator for effort operations.
 *
 * It composes persistence, processing, scheduling, and mutable execution state;
 * ingress adapters only translate their protocol into these operations.
 */
export class EffortCoordinator implements EffortOperations {
	private readonly executionState = new EffortExecutionState();
	private readonly processor: EffortProcessor;
	private readonly queue: EffortQueue;

	constructor(
		private readonly repository: EffortRepository,
		executor: TaskExecutorFn,
		options: EffortCoordinatorOptions = {},
	) {
		this.processor = new EffortProcessor(
			this.repository,
			this.executionState,
			executor,
			options,
		);
		this.queue = new EffortQueue(async (effortId, processOptions) => {
			const effort = this.repository.readEffort(effortId);
			if (!effort) return;
			await this.processor.process(effort, processOptions);
		});
	}

	get queueDepth(): number {
		return this.queue.depth;
	}

	enqueue(effortId: string): void {
		this.queue.enqueue(effortId);
	}

	async submit(effort: Effort): Promise<string> {
		this.repository.writeEffort(effort);

		const existing = this.repository.readResult(effort.id);
		if (!existing) {
			this.repository.writeResult({
				effortId: effort.id,
				status: "pending",
				results: [],
				submittedAt: effort.submittedAt,
				lastUpdatedAt: nowIso(),
			});
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
		if (!current || current.status === "in-progress") return false;
		if (current.status === "pending") return true;

		this.executionState.clearCancellation(effortId);
		this.repository.appendLog(effortId, {
			effortId,
			timestamp: nowIso(),
			level: "info",
			event: "retry_requested",
			message: "Retry requested",
		});
		this.queue.enqueue(effortId, { force: true });
		return true;
	}

	async cancel(effortId: string): Promise<boolean> {
		if (!this.repository.hasEffort(effortId)) return false;

		const current = this.repository.readResult(effortId);
		if (current && isTerminalEffortStatus(current.status)) return false;

		this.executionState.requestCancellation(effortId);
		this.repository.appendLog(effortId, {
			effortId,
			timestamp: nowIso(),
			level: "warn",
			event: "cancel_requested",
			message: "Cancellation requested",
		});

		if (!this.executionState.isInFlight(effortId)) {
			const timestamp = nowIso();
			this.repository.writeResult({
				effortId,
				status: "cancelled",
				results: current?.results ?? [],
				submittedAt: current?.submittedAt,
				startedAt: current?.startedAt,
				attemptCount: current?.attemptCount,
				lastUpdatedAt: timestamp,
				completedAt: timestamp,
			});
		}

		return true;
	}

	async summary(): Promise<EffortSummary> {
		return summarizeEfforts(await this.list());
	}

	async telemetry(): Promise<RuntimeTelemetrySnapshot> {
		const summary = await this.summary();
		return {
			...summary,
			queueDepth: this.queue.depth,
			inFlight: this.executionState.inFlightCount,
			cancelRequests: this.executionState.cancellationCount,
			generatedAt: nowIso(),
		};
	}

	async telemetryWindow(minutes: number): Promise<RuntimeTelemetryWindow> {
		return summarizeEffortWindow(await this.list(), minutes, Date.now());
	}

	async process(effort: Effort): Promise<void> {
		await this.processor.process(effort);
	}
}
