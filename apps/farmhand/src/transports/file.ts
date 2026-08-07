import type {
	Effort,
	EffortLogEntry,
	EffortResult,
	EffortSummary,
} from "@refarm.dev/effort-contract-v1";
import type { PressureSnapshot, PressureWindow } from "@refarm.dev/pressure-contract-v1";
import fs from "node:fs";
import path from "node:path";
import { EffortExecutionState } from "../effort-execution-state.js";
import type { EffortOperations } from "../effort-operations.js";
import {
	EffortProcessor,
	isTerminalEffortStatus,
	type EffortProcessorOptions,
	type TaskExecutorFn,
} from "../effort-processor.js";
import { EffortQueue } from "../effort-queue.js";
import { summarizeEfforts, summarizeEffortWindow } from "../effort-summary.js";
import { FileEffortRepository } from "./file-effort-repository.js";

export type { TaskExecutorFn };
export type FileTransportOptions = EffortProcessorOptions;

// The telemetry endpoint's wire shapes ARE the pressure:v1 contract's — this producer emits the
// exact PressureSnapshot / PressureWindow the operator's pressure client consumes (single source,
// no more local redeclaration that could drift on the EffortSummary fields). Aliased to the local
// names so the rest of this transport is untouched.
export type RuntimeTelemetrySnapshot = PressureSnapshot;
export type RuntimeTelemetryWindow = PressureWindow;

function nowIso(): string {
	return new Date().toISOString();
}
export class FileTransportAdapter implements EffortOperations {
	private readonly repository: FileEffortRepository;

	private readonly executionState = new EffortExecutionState();
	private readonly processor: EffortProcessor;
	private readonly queue: EffortQueue;

	constructor(baseDir: string, executor: TaskExecutorFn, options: FileTransportOptions = {}) {
		this.repository = new FileEffortRepository(baseDir);
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

	watch(): () => void {
		const processTaskFile = (filename: string): void => {
			if (!filename.endsWith(".json")) return;
			const effortId = filename.replace(/\.json$/, "");
			if (!effortId) return;
			this.queue.enqueue(effortId);
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
				this.queue.enqueue(effortId);
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

}
